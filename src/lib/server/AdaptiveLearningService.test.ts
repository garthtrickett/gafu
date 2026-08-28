import { Effect } from "effect";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "../../db/client.ts";
import { acceptMediaCandidate, type RecordMediaCandidateInput } from "./MediaCandidateService.ts";
import { deleteAdaptiveMediaData, listPendingMediaCheckouts, recordProgressEvent } from "./AdaptiveLearningService.ts";

const setupAcceptedPoint = async () => {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
  const input: RecordMediaCandidateInput = {
    id: crypto.randomUUID(), analysisRunId: crypto.randomUUID(), subtitleTrackFingerprint: "b".repeat(64),
    kind: "vocabulary", canonicalKey: `vocabulary:試す:${userId}:動詞`, reading: "ためす", meaning: "to try",
    confidence: 0.9, reviewCostClass: "light_vocabulary",
    evidence: [{ cueId: "cue-v1:test:srt:0", start: 0, end: 2 }], firstEncounterSeconds: 20, occurrenceCount: 1,
  };
  const reservation = await Effect.runPromise(acceptMediaCandidate(userId, input, `accept-${input.id}`));
  return { userId, input, knowledgePointId: reservation.knowledgePointId };
};

describe("adaptive media learning event loop", () => {
  it("primes idempotently, records passive encounter without grading, and checks out", async () => {
    const { userId, input, knowledgePointId } = await setupAcceptedPoint();
    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "primer_started", idempotencyKey: "primer-start",
    }));
    const primed = await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "primer_retrieval_completed", idempotencyKey: "primer-complete",
    }, new Date("2026-08-28T10:00:00.000Z")));
    expect(primed.nextState).toBe("primed");
    expect(await Effect.runPromise(listPendingMediaCheckouts(userId))).toHaveLength(1);

    const before = await db.selectFrom("srs_card").selectAll().where("knowledge_point_id", "=", knowledgePointId as never).executeTakeFirstOrThrow();
    const encounterInput = {
      knowledgePointId, candidateId: input.id, event: "cue_reached" as const, idempotencyKey: "cue-once",
      encounter: { cueId: "cue-v1:test:srt:0", timingTransformId: "manual-v1", effectivePlaybackSeconds: 20.5 },
    };
    const firstEncounter = await Effect.runPromise(recordProgressEvent(userId, encounterInput));
    const replayEncounter = await Effect.runPromise(recordProgressEvent(userId, encounterInput));
    expect(firstEncounter.nextState).toBe("encountered");
    expect(replayEncounter.replayed).toBe(true);
    const afterEncounter = await db.selectFrom("srs_card").selectAll().where("id", "=", before.id).executeTakeFirstOrThrow();
    expect(afterEncounter).toMatchObject({ repetitions: before.repetitions, stability: before.stability, checkout_due: true });
    expect(await db.selectFrom("media_encounter").select("id").where("user_id", "=", userId as never).execute()).toHaveLength(1);

    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "checkout_missed", idempotencyKey: "checkout-once",
    }, new Date("2026-08-28T11:00:00.000Z")));
    const checked = await db.selectFrom("srs_card").selectAll().where("id", "=", before.id).executeTakeFirstOrThrow();
    expect(checked).toMatchObject({ learning_state: "learning", checkout_due: false, repetitions: 0, interval_days: 1, stability: 0.5 });
    expect(checked.next_review.toISOString()).toBe("2026-08-29T11:00:00.000Z");
    expect(await Effect.runPromise(listPendingMediaCheckouts(userId))).toHaveLength(0);
  });

  it("keeps an abandoned primed point due for checkout recovery", async () => {
    const { userId, input, knowledgePointId } = await setupAcceptedPoint();
    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "primer_retrieval_completed", idempotencyKey: "prime-before-abandon",
    }));
    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "media_abandoned", idempotencyKey: "abandon-once",
    }));
    const progress = await db.selectFrom("srs_card").selectAll().where("knowledge_point_id", "=", knowledgePointId as never).executeTakeFirstOrThrow();
    expect(progress).toMatchObject({ learning_state: "learning", checkout_due: true, repetitions: 0, stability: 0 });
    expect(await Effect.runPromise(listPendingMediaCheckouts(userId))).toHaveLength(1);
  });

  it("deletes adaptive provenance while preserving point-level learning progress", async () => {
    const { userId, input, knowledgePointId } = await setupAcceptedPoint();
    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "primer_retrieval_completed", idempotencyKey: "delete-primer",
    }));
    await Effect.runPromise(recordProgressEvent(userId, {
      knowledgePointId, candidateId: input.id, event: "cue_reached", idempotencyKey: "delete-cue",
      encounter: { cueId: input.evidence[0]!.cueId, timingTransformId: "source", effectivePlaybackSeconds: 20 },
    }));
    const beforeDelete = await db.selectFrom("srs_card").select("hlc")
      .where("user_id", "=", userId as never).executeTakeFirstOrThrow();
    const deleted = await Effect.runPromise(deleteAdaptiveMediaData(userId));
    expect(deleted).toMatchObject({ deletedAnalysisCount: 1, deletedCheckoutCount: 1, deletedEncounterCount: 1 });
    expect(await db.selectFrom("media_candidate").select("id").where("user_id", "=", userId as never).execute()).toHaveLength(0);
    expect(await db.selectFrom("learner_progress_event").select("id").where("user_id", "=", userId as never).execute()).toHaveLength(0);
    const progress = await db.selectFrom("srs_card").selectAll().where("user_id", "=", userId as never).executeTakeFirstOrThrow();
    expect(progress.knowledge_point_id).toBe(knowledgePointId);
    expect(progress.checkout_due).toBe(false);
    expect(progress.hlc > beforeDelete.hlc).toBe(true);
  });
});
