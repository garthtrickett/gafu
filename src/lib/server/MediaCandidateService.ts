import { Data, Effect } from "effect";
import { sql } from "kysely";
import { db } from "../../db/client.ts";
import type {
  KnowledgePointId,
  MediaAnalysisRunId,
  MediaCandidateId,
  UserId,
} from "../../types/index.ts";
import { NORMALIZED_CUE_VERSION, type CandidateDisposition, type KnowledgePointKind } from "../shared/adaptive-media.ts";
import { reserveIntroduction, setLearnerPointStatus, type IntroductionReservation } from "./IntroductionAdmissionService.ts";

export interface PrivateMediaEvidenceReference {
  readonly cueId: string;
  readonly start: number;
  readonly end: number;
}

export interface RecordMediaCandidateInput {
  readonly id: string;
  readonly analysisRunId: string;
  readonly subtitleTrackFingerprint: string;
  readonly kind: KnowledgePointKind;
  readonly canonicalKey: string;
  readonly reading: string | null;
  readonly meaning: string;
  readonly confidence: number;
  readonly reviewCostClass: "light_vocabulary" | "difficult_vocabulary" | "grammar";
  readonly evidence: readonly PrivateMediaEvidenceReference[];
  readonly firstEncounterSeconds: number;
  readonly occurrenceCount: number;
}

export class MediaCandidateError extends Data.TaggedError("MediaCandidateError")<{
  readonly code: "invalid_candidate" | "candidate_not_found" | "candidate_not_resolved" | "storage_failed";
}> {}

const validateCandidate = (input: RecordMediaCandidateInput): boolean =>
  input.id.length > 0 &&
  input.analysisRunId.length > 0 &&
  input.subtitleTrackFingerprint.length > 0 &&
  input.canonicalKey.startsWith(`${input.kind}:`) &&
  input.meaning.trim().length > 0 &&
  input.confidence >= 0 && input.confidence <= 1 &&
  input.occurrenceCount > 0 && input.firstEncounterSeconds >= 0 &&
  input.evidence.length > 0 && input.evidence.every((evidence) =>
    evidence.cueId.length > 0 && evidence.start >= 0 && evidence.end > evidence.start
  );

const safeEvidence = (input: RecordMediaCandidateInput) => input.evidence.map((evidence) => ({
  cueId: evidence.cueId,
  start: evidence.start,
  end: evidence.end,
}));

export const recordMediaCandidate = (
  userId: string,
  input: RecordMediaCandidateInput,
): Effect.Effect<string, MediaCandidateError> => {
  if (!validateCandidate(input)) return Effect.fail(new MediaCandidateError({ code: "invalid_candidate" }));
  return Effect.tryPromise({
    try: () => db.transaction().execute(async (trx) => {
      const now = new Date();
      await trx.insertInto("media_analysis_run").values({
        id: input.analysisRunId as MediaAnalysisRunId,
        user_id: userId as UserId,
        subtitle_track_fingerprint: input.subtitleTrackFingerprint,
        normalization_version: NORMALIZED_CUE_VERSION,
        status: "completed",
      }).onConflict((conflict) => conflict.columns(["id", "user_id"]).doUpdateSet({ updated_at: now })).execute();
      const row = await trx.insertInto("media_candidate").values({
        id: input.id as MediaCandidateId,
        user_id: userId as UserId,
        analysis_run_id: input.analysisRunId as MediaAnalysisRunId,
        kind: input.kind,
        canonical_key: input.canonicalKey,
        reading: input.reading,
        meaning: input.meaning,
        confidence: input.confidence,
        review_cost_class: input.reviewCostClass,
        evidence: sql`${JSON.stringify(safeEvidence(input))}::jsonb`,
        first_encounter_seconds: input.firstEncounterSeconds,
        occurrence_count: input.occurrenceCount,
      }).onConflict((conflict) => conflict.columns(["user_id", "analysis_run_id", "kind", "canonical_key"]).doUpdateSet({
        confidence: input.confidence,
        evidence: sql`${JSON.stringify(safeEvidence(input))}::jsonb`,
        first_encounter_seconds: input.firstEncounterSeconds,
        occurrence_count: input.occurrenceCount,
        updated_at: now,
      })).returning("id").executeTakeFirstOrThrow();
      return row.id;
    }),
    catch: () => new MediaCandidateError({ code: "storage_failed" }),
  });
};

const canonicalName = (canonicalKey: string): string => canonicalKey.slice(canonicalKey.indexOf(":") + 1).split(":")[0] ?? canonicalKey;

export const resolveMediaCandidate = (
  userId: string,
  candidateId: string,
): Effect.Effect<string, MediaCandidateError> => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
    const candidate = await trx.selectFrom("media_candidate").selectAll()
      .where("id", "=", candidateId as MediaCandidateId)
      .where("user_id", "=", userId as UserId)
      .executeTakeFirst();
    if (!candidate) throw new MediaCandidateError({ code: "candidate_not_found" });
    if (candidate.resolved_knowledge_point_id) return candidate.resolved_knowledge_point_id;
    const existing = await trx.selectFrom("knowledge_point").select("id")
      .where("kind", "=", candidate.kind)
      .where("canonical_key", "=", candidate.canonical_key)
      .where((expression) => expression.or([
        expression("scope", "=", "curated"),
        expression.and([
          expression("scope", "=", "personal"),
          expression("owner_user_id", "=", userId as UserId),
        ]),
      ]))
      .orderBy(sql`CASE WHEN scope = 'curated' THEN 0 ELSE 1 END`)
      .executeTakeFirst();
    const knowledgePointId = existing?.id ?? crypto.randomUUID() as KnowledgePointId;
    if (!existing) {
      await trx.insertInto("knowledge_point").values({
        id: knowledgePointId,
        kind: candidate.kind,
        canonical_key: candidate.canonical_key,
        scope: "personal",
        owner_user_id: userId as UserId,
        catalogue_status: "active",
        created_from: "media",
        confidence: candidate.confidence,
      }).execute();
      if (candidate.kind === "vocabulary") {
        const parts = candidate.canonical_key.split(":");
        await trx.insertInto("vocabulary_point").values({
          knowledge_point_id: knowledgePointId,
          lemma: parts[1] || canonicalName(candidate.canonical_key),
          reading: candidate.reading || parts[2] || "",
          part_of_speech: parts[3] || "unknown",
          sense_key: candidate.canonical_key,
          meaning: candidate.meaning,
          register: null,
        }).execute();
      } else {
        await trx.insertInto("grammar_point").values({
          id: knowledgePointId,
          deck_id: null,
          formal_name: canonicalName(candidate.canonical_key),
          base_meaning: candidate.meaning,
          lesson_number: 0,
          sequence_order: 0,
          difficulty_level: "personal",
        }).execute();
      }
    }
    await trx.updateTable("media_candidate").set({
      resolved_knowledge_point_id: knowledgePointId,
      updated_at: new Date(),
    }).where("id", "=", candidate.id).execute();
    return knowledgePointId;
  }),
  catch: (cause) => cause instanceof MediaCandidateError ? cause : new MediaCandidateError({ code: "storage_failed" }),
});

export const setMediaCandidateDisposition = (
  userId: string,
  candidateId: string,
  disposition: CandidateDisposition,
): Effect.Effect<void, MediaCandidateError> => Effect.tryPromise({
  try: async () => {
    const candidate = await db.selectFrom("media_candidate").select("resolved_knowledge_point_id")
      .where("id", "=", candidateId as MediaCandidateId)
      .where("user_id", "=", userId as UserId).executeTakeFirst();
    if (!candidate) throw new MediaCandidateError({ code: "candidate_not_found" });
    if ((disposition === "accepted" || disposition === "already_known") && !candidate.resolved_knowledge_point_id) {
      throw new MediaCandidateError({ code: "candidate_not_resolved" });
    }
    await db.updateTable("media_candidate").set({ disposition, updated_at: new Date() })
      .where("id", "=", candidateId as MediaCandidateId).execute();
  },
  catch: (cause) => cause instanceof MediaCandidateError ? cause : new MediaCandidateError({ code: "storage_failed" }),
});

export const acceptMediaCandidate = (
  userId: string,
  input: RecordMediaCandidateInput,
  idempotencyKey: string,
): Effect.Effect<IntroductionReservation, MediaCandidateError | import("./IntroductionAdmissionService.ts").IntroductionAdmissionError> => Effect.gen(function* () {
  const candidateId = yield* recordMediaCandidate(userId, input);
  const knowledgePointId = yield* resolveMediaCandidate(userId, candidateId);
  const reservation = yield* reserveIntroduction(userId, knowledgePointId, idempotencyKey);
  if (reservation.accepted) yield* setMediaCandidateDisposition(userId, candidateId, "accepted");
  return reservation;
});

export const markMediaCandidateKnown = (
  userId: string,
  input: RecordMediaCandidateInput,
): Effect.Effect<void, MediaCandidateError | import("./IntroductionAdmissionService.ts").IntroductionAdmissionError> => Effect.gen(function* () {
  const candidateId = yield* recordMediaCandidate(userId, input);
  const knowledgePointId = yield* resolveMediaCandidate(userId, candidateId);
  yield* setLearnerPointStatus(userId, knowledgePointId, "mark_known");
  yield* setMediaCandidateDisposition(userId, candidateId, "already_known");
});
