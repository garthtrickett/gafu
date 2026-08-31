import { Effect } from "effect";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "../../db/client.ts";
import { reserveIntroduction, setLearnerPointStatus } from "./IntroductionAdmissionService.ts";

describe("server-authoritative introduction admission", () => {
  it("serializes concurrent grammar/vocabulary admissions at the global hard limit", async () => {
    const userId = crypto.randomUUID();
    await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
    await sql`
      INSERT INTO user_preference (user_id, daily_review_limit, daily_new_rule_limit, learner_time_zone)
      VALUES (${userId}::uuid, 20, 5, 'Pacific/Auckland')
    `.execute(db);
    const pointIds = Array.from({ length: 6 }, () => crypto.randomUUID());
    for (const [index, pointId] of pointIds.entries()) {
      await sql`
        INSERT INTO knowledge_point (id, kind, canonical_key, scope, catalogue_status, created_from)
        VALUES (${pointId}::uuid, 'vocabulary', ${`vocabulary:test-${index}`}, 'curated', 'active', 'catalogue')
      `.execute(db);
      await sql`
        INSERT INTO vocabulary_point (knowledge_point_id, lemma, reading, part_of_speech, sense_key, meaning)
        VALUES (${pointId}::uuid, ${`語${index}`}, ${`ご${index}`}, 'noun', '1', ${`word ${index}`})
      `.execute(db);
    }

    const results = await Promise.all(pointIds.map((pointId, index) =>
      Effect.runPromise(reserveIntroduction(userId, pointId, `request-${index}`, new Date("2026-08-28T23:30:00.000Z"))),
    ));
    expect(results.filter((result) => result.accepted)).toHaveLength(5);
    expect(results.filter((result) => !result.accepted)).toEqual([
      expect.objectContaining({ reason: "daily_limit" }),
    ]);
    expect(new Set(results.map((result) => result.learnerDay))).toEqual(new Set(["2026-08-29"]));

    const schedules = await db.selectFrom("srs_card")
      .select(["knowledge_point_id", "grammar_point_id", "learning_state"])
      .where("user_id", "=", userId as never)
      .execute();
    expect(schedules).toHaveLength(5);
    expect(schedules.every((schedule) => schedule.grammar_point_id === null && schedule.learning_state === "introduced")).toBe(true);
  });

  it("replays an idempotency key without creating a second schedule", async () => {
    const userId = crypto.randomUUID();
    const pointId = crypto.randomUUID();
    await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
    await sql`
      INSERT INTO knowledge_point (id, kind, canonical_key, scope, catalogue_status, created_from)
      VALUES (${pointId}::uuid, 'vocabulary', ${`vocabulary:${pointId}`}, 'curated', 'active', 'catalogue')
    `.execute(db);
    const first = await Effect.runPromise(reserveIntroduction(userId, pointId, "same-request"));
    const replay = await Effect.runPromise(reserveIntroduction(userId, pointId, "same-request"));
    const resumedAfterReload = await Effect.runPromise(reserveIntroduction(userId, pointId, "new-client-request"));
    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);
    expect(resumedAfterReload).toMatchObject({ accepted: true, knowledgePointId: pointId, reason: "accepted" });
    const schedules = await db.selectFrom("srs_card").select("id")
      .where("user_id", "=", userId as never)
      .where("knowledge_point_id", "=", pointId as never)
      .execute();
    expect(schedules).toHaveLength(1);
    expect(await db.selectFrom("introduction_admission").select("id")
      .where("user_id", "=", userId as never)
      .where("knowledge_point_id", "=", pointId as never)
      .execute()).toHaveLength(1);
  });

  it("marks vocabulary known without manufacturing review success and supports archive/reactivate", async () => {
    const userId = crypto.randomUUID();
    const pointId = crypto.randomUUID();
    await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
    await sql`
      INSERT INTO knowledge_point (id, kind, canonical_key, scope, catalogue_status, created_from)
      VALUES (${pointId}::uuid, 'vocabulary', ${`vocabulary:${pointId}`}, 'curated', 'active', 'catalogue')
    `.execute(db);

    expect(await Effect.runPromise(setLearnerPointStatus(userId, pointId, "mark_known")))
      .toEqual({ updated: true, reason: "marked_known" });
    const known = await db.selectFrom("srs_card").selectAll()
      .where("user_id", "=", userId as never)
      .where("knowledge_point_id", "=", pointId as never)
      .executeTakeFirstOrThrow();
    expect(known).toMatchObject({ learning_state: "known", repetitions: 0, stability: 0 });
    expect(known.last_reviewed_at).toBeNull();
    expect(known.hlc).not.toBe("0000000000000:0000:initial");

    const knownHlc = known.hlc;
    expect(await Effect.runPromise(setLearnerPointStatus(userId, pointId, "archive")))
      .toEqual({ updated: true, reason: "archive" });
    expect(await Effect.runPromise(setLearnerPointStatus(userId, pointId, "reactivate")))
      .toEqual({ updated: true, reason: "reactivate" });
    const reactivated = await db.selectFrom("srs_card").select(["participation_status", "hlc"])
      .where("id", "=", known.id).executeTakeFirstOrThrow();
    expect(reactivated.participation_status).toBe("active");
    expect(reactivated.hlc > knownHlc).toBe(true);
  });
});
