import { Effect } from "effect";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "../../db/client.ts";
import {
  acceptMediaCandidate,
  markMediaCandidateKnown,
  recordMediaCandidate,
  resolveMediaCandidate,
  setMediaCandidateDisposition,
  type RecordMediaCandidateInput,
} from "./MediaCandidateService.ts";

const createUser = async () => {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
  return userId;
};

const vocabularyCandidate = (): RecordMediaCandidateInput => ({
  id: crypto.randomUUID(),
  analysisRunId: crypto.randomUUID(),
  subtitleTrackFingerprint: "a".repeat(64),
  kind: "vocabulary",
  canonicalKey: "vocabulary:歩く:アルク:動詞",
  reading: "あるく",
  meaning: "to walk",
  confidence: 0.91,
  reviewCostClass: "light_vocabulary",
  evidence: [{ cueId: "cue-v1:synthetic:srt:1", start: 0, end: 2 }],
  firstEncounterSeconds: 15,
  occurrenceCount: 2,
});

describe("media candidate lifecycle ownership", () => {
  it("resolves an accepted vocabulary discovery to one personal point and one schedule", async () => {
    const userId = await createUser();
    const input = vocabularyCandidate();
    const first = await Effect.runPromise(acceptMediaCandidate(userId, input, "accept-once"));
    const replay = await Effect.runPromise(acceptMediaCandidate(userId, input, "accept-once"));
    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);
    const candidate = await db.selectFrom("media_candidate").selectAll().where("id", "=", input.id as never).executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({ disposition: "accepted", occurrence_count: 2 });
    expect(JSON.stringify(candidate.evidence)).not.toContain("歩く");
    const point = await db.selectFrom("knowledge_point").selectAll()
      .where("id", "=", candidate.resolved_knowledge_point_id!).executeTakeFirstOrThrow();
    expect(point).toMatchObject({ scope: "personal", owner_user_id: userId, created_from: "media" });
    const schedules = await db.selectFrom("srs_card").selectAll()
      .where("user_id", "=", userId as never)
      .where("knowledge_point_id", "=", point.id).execute();
    expect(schedules).toHaveLength(1);
  });

  it("accepts and stores a normalized key when an older client submits a bare AI key", async () => {
    const userId = await createUser();
    const input = { ...vocabularyCandidate(), canonicalKey: "もったいない", reading: "もったいない" };

    const accepted = await Effect.runPromise(acceptMediaCandidate(userId, input, "accept-bare-key"));

    expect(accepted.accepted).toBe(true);
    const candidate = await db.selectFrom("media_candidate").select(["canonical_key", "resolved_knowledge_point_id"])
      .where("id", "=", input.id as never).executeTakeFirstOrThrow();
    expect(candidate.canonical_key).toBe("vocabulary:もったいない");
    const point = await db.selectFrom("knowledge_point").select("canonical_key")
      .where("id", "=", candidate.resolved_knowledge_point_id!).executeTakeFirstOrThrow();
    expect(point.canonical_key).toBe("vocabulary:もったいない");
  });

  it("keeps rejection as candidate disposition without creating a point or schedule", async () => {
    const userId = await createUser();
    const input = vocabularyCandidate();
    const candidateId = await Effect.runPromise(recordMediaCandidate(userId, input));
    await Effect.runPromise(setMediaCandidateDisposition(userId, candidateId, "rejected"));
    const candidate = await db.selectFrom("media_candidate").selectAll().where("id", "=", candidateId as never).executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({ disposition: "rejected", resolved_knowledge_point_id: null });
    expect(await db.selectFrom("srs_card").select("id").where("user_id", "=", userId as never).execute()).toHaveLength(0);
  });

  it("supports personal grammar detail and already-known without a review success", async () => {
    const userId = await createUser();
    const input: RecordMediaCandidateInput = {
      ...vocabularyCandidate(),
      id: crypto.randomUUID(),
      analysisRunId: crypto.randomUUID(),
      kind: "grammar",
      canonicalKey: "grammar:〜ておく",
      reading: null,
      meaning: "do in advance",
      reviewCostClass: "grammar",
    };
    await Effect.runPromise(markMediaCandidateKnown(userId, input));
    const candidateId = await Effect.runPromise(recordMediaCandidate(userId, input));
    const pointId = await Effect.runPromise(resolveMediaCandidate(userId, candidateId));
    const detail = await db.selectFrom("grammar_point").selectAll().where("id", "=", pointId as never).executeTakeFirstOrThrow();
    expect(detail).toMatchObject({ deck_id: null, lesson_number: 0, formal_name: "〜ておく" });
    const progress = await db.selectFrom("srs_card").selectAll().where("knowledge_point_id", "=", pointId as never).executeTakeFirstOrThrow();
    expect(progress).toMatchObject({ learning_state: "known", repetitions: 0, stability: 0 });
    expect(progress.last_reviewed_at).toBeNull();
  });
});
