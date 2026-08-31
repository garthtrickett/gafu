import { Data, Effect } from "effect";
import { sql } from "kysely";
import { db } from "../../db/client.ts";
import type { KnowledgePointId, SrsCardId, UserId } from "../../types/index.ts";
import {
  learnerDayKey,
  previewIntroductionCapacity,
  projectedSevenDayCost,
} from "../shared/adaptive-scheduling.ts";
import { initHlc, packHlc, receiveHlc } from "../shared/hlc.ts";

export class IntroductionAdmissionError extends Data.TaggedError("IntroductionAdmissionError")<{
  readonly cause: unknown;
}> {}

export interface IntroductionReservation {
  readonly accepted: boolean;
  readonly knowledgePointId: string;
  readonly learnerDay: string;
  readonly reason: "accepted" | "already_scheduled" | "daily_limit" | "unstable_pool" | "mature_backlog";
}

export const reserveIntroduction = (
  userId: string,
  knowledgePointId: string,
  idempotencyKey: string,
  now: Date = new Date(),
) => Effect.tryPromise({
  try: () => db.transaction().setIsolationLevel("read committed").execute(async (trx): Promise<IntroductionReservation> => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
    const preference = await trx.selectFrom("user_preference")
      .select(["daily_new_rule_limit", "learner_time_zone"])
      .where("user_id", "=", userId as UserId)
      .executeTakeFirst();
    const learnerDay = learnerDayKey(now, preference?.learner_time_zone ?? "UTC");

    const replay = await trx.selectFrom("introduction_admission")
      .select(["knowledge_point_id", "learner_day"])
      .where("user_id", "=", userId as UserId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      return { accepted: true, knowledgePointId: replay.knowledge_point_id, learnerDay, reason: "accepted" };
    }

    const existingSchedule = await trx.selectFrom("srs_card")
      .select("id")
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .executeTakeFirst();
    if (existingSchedule) {
      const priorAdmission = await trx.selectFrom("introduction_admission")
        .select("learner_day")
        .where("user_id", "=", userId as UserId)
        .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
        .executeTakeFirst();
      if (priorAdmission) {
        return {
          accepted: true,
          knowledgePointId,
          learnerDay: String(priorAdmission.learner_day),
          reason: "accepted",
        };
      }
      return { accepted: false, knowledgePointId, learnerDay, reason: "already_scheduled" };
    }

    const point = await trx.selectFrom("knowledge_point")
      .select(["id", "kind", "catalogue_status"])
      .where("id", "=", knowledgePointId as KnowledgePointId)
      .where("catalogue_status", "=", "active")
      .executeTakeFirstOrThrow();

    const admissions = await trx.selectFrom("introduction_admission")
      .select(({ fn }) => [
        fn.countAll<number>().as("count"),
        fn.coalesce(fn.sum<number>("projected_review_cost"), sql<number>`0`).as("projected_cost"),
      ])
      .where("user_id", "=", userId as UserId)
      .where("learner_day", "=", learnerDay as never)
      .executeTakeFirstOrThrow();
    const unstable = await trx.selectFrom("srs_card")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("user_id", "=", userId as UserId)
      .where("participation_status", "=", "active")
      .where("learning_state", "not in", ["stable", "known"])
      .where("introduced_at", ">=", new Date(now.getTime() - 7 * 86_400_000))
      .executeTakeFirstOrThrow();
    const matureBacklog = await trx.selectFrom("srs_card")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("user_id", "=", userId as UserId)
      .where("participation_status", "=", "active")
      .where("learning_state", "=", "stable")
      .where("next_review", "<=", now)
      .executeTakeFirstOrThrow();
    const candidate = { kind: point.kind as "grammar" | "vocabulary", difficulty: point.kind === "grammar" ? 6 : 5 };
    const decision = previewIntroductionCapacity({
      admittedToday: Number(admissions.count),
      projectedCostToday: Number(admissions.projected_cost),
      unstableRecentCount: Number(unstable.count),
      preferredDailyLimit: preference?.daily_new_rule_limit,
      matureBacklogCount: Number(matureBacklog.count),
    }, candidate);
    if (!decision.allowed) {
      const reason = decision.reason === "available" ? "daily_limit" : decision.reason;
      return { accepted: false, knowledgePointId, learnerDay, reason };
    }

    await trx.insertInto("introduction_admission").values({
      user_id: userId as UserId,
      knowledge_point_id: knowledgePointId as KnowledgePointId,
      learner_day: learnerDay,
      projected_review_cost: projectedSevenDayCost(candidate),
      idempotency_key: idempotencyKey,
    }).execute();
    await trx.insertInto("srs_card").values({
      id: crypto.randomUUID() as SrsCardId,
      user_id: userId as UserId,
      knowledge_point_id: knowledgePointId as KnowledgePointId,
      grammar_point_id: point.kind === "grammar" ? knowledgePointId as KnowledgePointId : null,
      ease_factor: 2.5,
      repetitions: 0,
      interval_days: 0,
      next_review: now,
      difficulty: 5,
      stability: 0,
      participation_status: "active",
      learning_state: "introduced",
      introduced_at: now,
      created_at: now,
      updated_at: now,
    }).execute();
    return { accepted: true, knowledgePointId, learnerDay, reason: "accepted" };
  }),
  catch: (cause) => new IntroductionAdmissionError({ cause }),
});

export type LearnerPointAction = "mark_known" | "archive" | "reactivate";

export const setLearnerPointStatus = (
  userId: string,
  knowledgePointId: string,
  action: LearnerPointAction,
  now: Date = new Date(),
) => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    const nextHlc = (previous = "0000000000000:0000:initial") => packHlc(receiveHlc(
      initHlc("server-learner-status", now.getTime()),
      previous,
      now.getTime(),
    ));
    const point = await trx.selectFrom("knowledge_point")
      .select(["id", "kind"])
      .where("id", "=", knowledgePointId as KnowledgePointId)
      .executeTakeFirstOrThrow();
    const existing = await trx.selectFrom("srs_card")
      .selectAll()
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .executeTakeFirst();
    if (!existing) {
      if (action !== "mark_known") return { updated: false, reason: "not_scheduled" as const };
      await trx.insertInto("srs_card").values({
        id: crypto.randomUUID() as SrsCardId,
        user_id: userId as UserId,
        knowledge_point_id: knowledgePointId as KnowledgePointId,
        grammar_point_id: point.kind === "grammar" ? knowledgePointId as KnowledgePointId : null,
        next_review: now,
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        difficulty: 5,
        stability: 0,
        learning_state: "known",
        participation_status: "active",
        introduced_at: null,
        created_at: now,
        updated_at: now,
        hlc: nextHlc(),
      }).execute();
      return { updated: true, reason: "marked_known" as const };
    }
    await trx.updateTable("srs_card")
      .set(action === "mark_known" ? {
        learning_state: "known",
        updated_at: now,
        hlc: nextHlc(existing.hlc),
      } : {
        participation_status: action === "archive" ? "archived" : "active",
        updated_at: now,
        hlc: nextHlc(existing.hlc),
      })
      .where("id", "=", existing.id)
      .execute();
    return { updated: true, reason: action };
  }),
  catch: (cause) => new IntroductionAdmissionError({ cause }),
});
