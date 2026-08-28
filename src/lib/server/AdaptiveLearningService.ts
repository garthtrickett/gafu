import { Data, Effect } from "effect";
import { sql } from "kysely";
import { db } from "../../db/client.ts";
import type { GeneratedExerciseId, KnowledgePointId, MediaCandidateId, UserId } from "../../types/index.ts";
import {
  quarantineTargetForWrongAnalysis,
  transitionLearnerProgress,
  type LearnerProgressEvent,
} from "../shared/adaptive-media.ts";
import { applyVariationMasteryLimit, calculateSrsUpdate } from "../shared/srs-scheduling.ts";
import { initHlc, packHlc, receiveHlc } from "../shared/hlc.ts";
import { setLearnerPointStatus } from "./IntroductionAdmissionService.ts";
import { setMediaCandidateDisposition } from "./MediaCandidateService.ts";

export class AdaptiveLearningError extends Data.TaggedError("AdaptiveLearningError")<{
  readonly code: "progress_not_found" | "invalid_transition" | "encounter_metadata_required" | "storage_failed";
}> {}

export interface ProgressEventInput {
  readonly knowledgePointId: string;
  readonly candidateId: string | null;
  readonly event: LearnerProgressEvent;
  readonly idempotencyKey: string;
  readonly exerciseId?: string;
  readonly responseTimeMs?: number | null;
  readonly encounter?: {
    readonly cueId: string;
    readonly timingTransformId: string;
    readonly effectivePlaybackSeconds: number;
  };
}

export interface ProgressEventResult {
  readonly knowledgePointId: string;
  readonly previousState: string;
  readonly nextState: string;
  readonly replayed: boolean;
}

export const recordProgressEvent = (
  userId: string,
  input: ProgressEventInput,
  now = new Date(),
): Effect.Effect<ProgressEventResult, AdaptiveLearningError> => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${input.knowledgePointId}`}))`.execute(trx);
    const replay = await trx.selectFrom("learner_progress_event").select(["previous_state", "next_state"])
      .where("user_id", "=", userId as UserId)
      .where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (replay) return {
      knowledgePointId: input.knowledgePointId,
      previousState: replay.previous_state ?? "none",
      nextState: replay.next_state,
      replayed: true,
    };
    const progress = await trx.selectFrom("srs_card").selectAll()
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
      .executeTakeFirst();
    if (!progress) throw new AdaptiveLearningError({ code: "progress_not_found" });
    const transition = transitionLearnerProgress(progress.learning_state as never, input.event);
    if (transition._tag === "TransitionRejected") throw new AdaptiveLearningError({ code: "invalid_transition" });
    if (input.event === "cue_reached" && !input.encounter) throw new AdaptiveLearningError({ code: "encounter_metadata_required" });

    await trx.insertInto("learner_progress_event").values({
      user_id: userId as UserId,
      knowledge_point_id: input.knowledgePointId as KnowledgePointId,
      candidate_id: input.candidateId as MediaCandidateId | null,
      event_type: input.event,
      previous_state: progress.learning_state,
      next_state: transition.nextState,
      idempotency_key: input.idempotencyKey,
      occurred_at: now,
    }).execute();

    if (input.event === "cue_reached" && input.encounter) {
      await trx.insertInto("media_encounter").values({
        user_id: userId as UserId,
        knowledge_point_id: input.knowledgePointId as KnowledgePointId,
        candidate_id: input.candidateId as MediaCandidateId | null,
        cue_id: input.encounter.cueId,
        timing_transform_id: input.encounter.timingTransformId,
        effective_playback_seconds: input.encounter.effectivePlaybackSeconds,
        idempotency_key: input.idempotencyKey,
        reached_at: now,
      }).execute();
    }

    const checkoutCompleted = input.event === "checkout_recalled" || input.event === "checkout_missed";
    let metrics = checkoutCompleted ? calculateSrsUpdate({
      easeFactor: progress.ease_factor,
      repetitions: progress.repetitions,
      intervalDays: progress.interval_days,
      difficulty: Number(progress.difficulty),
      stability: Number(progress.stability),
    }, input.event === "checkout_recalled", now, () => 0.5) : null;
    let successfulMaterialContextCount = 0;
    let exercise: {
      id: GeneratedExerciseId;
      modality: string;
      material_context_key: string;
    } | null = null;
    if (checkoutCompleted && input.exerciseId && metrics) {
      exercise = await trx.selectFrom("generated_exercise")
        .select(["id", "modality", "material_context_key"])
        .where("id", "=", input.exerciseId as GeneratedExerciseId)
        .where("user_id", "=", userId as UserId)
        .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
        .executeTakeFirst() ?? null;
      if (!exercise) throw new AdaptiveLearningError({ code: "storage_failed" });
      if (input.event === "checkout_recalled") {
        const prior = await trx.selectFrom("retrieval_evidence").select("material_context_key").distinct()
          .where("user_id", "=", userId as UserId)
          .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
          .where("result", "=", "recalled").execute();
        successfulMaterialContextCount = new Set([
          ...prior.map((row) => row.material_context_key),
          exercise.material_context_key,
        ]).size;
      }
      metrics = applyVariationMasteryLimit(metrics, successfulMaterialContextCount, now);
      await trx.insertInto("retrieval_evidence").values({
        user_id: userId as UserId,
        knowledge_point_id: input.knowledgePointId as KnowledgePointId,
        exercise_id: exercise.id,
        result: input.event === "checkout_recalled" ? "recalled" : "missed",
        response_time_ms: input.responseTimeMs ?? null,
        modality: exercise.modality,
        material_context_key: exercise.material_context_key,
        scheduling_change: sql`${JSON.stringify({
          metrics,
          successfulMaterialContextCount,
          masteryLimited: successfulMaterialContextCount < 2,
        })}::jsonb`,
        idempotency_key: input.idempotencyKey,
        reviewed_at: now,
      }).execute();
    }
    const nextState = checkoutCompleted && input.event === "checkout_recalled"
      && successfulMaterialContextCount >= 2 && (metrics?.stability ?? 0) >= 7
      ? "stable"
      : transition.nextState;
    await trx.updateTable("srs_card").set({
      learning_state: nextState,
      checkout_due: input.event === "primer_retrieval_completed" || input.event === "media_abandoned"
        ? true
        : checkoutCompleted ? false : progress.checkout_due,
      ...(metrics ? {
        ease_factor: metrics.easeFactor,
        repetitions: metrics.repetitions,
        interval_days: metrics.intervalDays,
        difficulty: metrics.difficulty,
        stability: metrics.stability,
        last_reviewed_at: new Date(metrics.lastReviewedAt),
        next_review: new Date(metrics.nextReview),
      } : {}),
      updated_at: now,
      hlc: packHlc(receiveHlc(initHlc("server-adaptive", now.getTime()), progress.hlc, now.getTime())),
    }).where("id", "=", progress.id).execute();

    if (input.event === "primer_retrieval_completed") {
      const pending = await trx.selectFrom("media_checkout").select("id")
        .where("user_id", "=", userId as UserId)
        .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
        .where("status", "=", "pending").executeTakeFirst();
      if (!pending) await trx.insertInto("media_checkout").values({
        user_id: userId as UserId,
        knowledge_point_id: input.knowledgePointId as KnowledgePointId,
        candidate_id: input.candidateId as MediaCandidateId | null,
      }).execute();
    }
    if (checkoutCompleted) await trx.updateTable("media_checkout").set({
      status: "completed",
      outcome: input.event === "checkout_recalled" ? "recalled" : "missed",
      completed_at: now,
      updated_at: now,
    }).where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
      .where("status", "=", "pending").execute();

    return {
      knowledgePointId: input.knowledgePointId,
      previousState: progress.learning_state,
      nextState,
      replayed: false,
    };
  }),
  catch: (cause) => cause instanceof AdaptiveLearningError ? cause : new AdaptiveLearningError({ code: "storage_failed" }),
});

export type AlternativeCheckoutOutcome = "already_known" | "wrongly_analyzed" | "not_useful";

export const completeAlternativeCheckout = (
  userId: string,
  knowledgePointId: string,
  candidateId: string | null,
  outcome: AlternativeCheckoutOutcome,
  canonicalDefinitionInvalid = false,
  now = new Date(),
) => Effect.gen(function* () {
  if (outcome === "already_known") yield* setLearnerPointStatus(userId, knowledgePointId, "mark_known");
  if (outcome === "not_useful") yield* setLearnerPointStatus(userId, knowledgePointId, "archive");
  if (candidateId && (outcome === "not_useful" || outcome === "wrongly_analyzed")) {
    yield* setMediaCandidateDisposition(userId, candidateId, outcome);
  }
  yield* Effect.tryPromise({
    try: () => db.transaction().execute(async (trx) => {
      if (outcome === "wrongly_analyzed") {
        const point = await trx.selectFrom("knowledge_point").select("scope")
          .where("id", "=", knowledgePointId as KnowledgePointId).executeTakeFirstOrThrow();
        if (quarantineTargetForWrongAnalysis(point.scope as "curated" | "personal", canonicalDefinitionInvalid) === "personal_knowledge_point") {
          await trx.updateTable("knowledge_point").set({ catalogue_status: "quarantined", updated_at: now })
            .where("id", "=", knowledgePointId as KnowledgePointId).execute();
        }
      }
      await trx.updateTable("srs_card").set({
        checkout_due: false,
        ...(outcome === "wrongly_analyzed" ? { learning_state: "learning" } : {}),
        updated_at: now,
      }).where("user_id", "=", userId as UserId)
        .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId).execute();
      await trx.updateTable("media_checkout").set({
        status: "completed", outcome, completed_at: now, updated_at: now,
      }).where("user_id", "=", userId as UserId)
        .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
        .where("status", "=", "pending").execute();
    }),
    catch: () => new AdaptiveLearningError({ code: "storage_failed" }),
  });
});

export const listPendingMediaCheckouts = (userId: string) => Effect.tryPromise({
  try: () => db.selectFrom("media_checkout")
    .innerJoin("knowledge_point", "knowledge_point.id", "media_checkout.knowledge_point_id")
    .innerJoin("srs_card", "srs_card.knowledge_point_id", "media_checkout.knowledge_point_id")
    .leftJoin("vocabulary_point", "vocabulary_point.knowledge_point_id", "knowledge_point.id")
    .leftJoin("grammar_point", "grammar_point.id", "knowledge_point.id")
    .leftJoin("media_candidate", "media_candidate.id", "media_checkout.candidate_id")
    .leftJoin("media_analysis_run", "media_analysis_run.id", "media_candidate.analysis_run_id")
    .select([
      "media_checkout.id", "media_checkout.knowledge_point_id", "media_checkout.candidate_id", "media_checkout.created_at",
      "knowledge_point.kind", "knowledge_point.canonical_key", "vocabulary_point.reading", "vocabulary_point.meaning",
      "grammar_point.base_meaning",
      "media_candidate.evidence", "media_analysis_run.subtitle_track_fingerprint",
      "srs_card.learning_state",
    ])
    .where("media_checkout.user_id", "=", userId as UserId)
    .where("srs_card.user_id", "=", userId as UserId)
    .where("media_checkout.status", "=", "pending")
    .orderBy("media_checkout.created_at", "asc")
    .execute()
    .then((rows) => rows.map((row) => ({
      id: row.id,
      knowledgePointId: row.knowledge_point_id,
      candidateId: row.candidate_id,
      kind: row.kind,
      canonicalKey: row.canonical_key,
      reading: row.reading ?? "",
      meaning: row.meaning ?? row.base_meaning ?? "",
      learningState: row.learning_state,
      subtitleTrackFingerprint: row.subtitle_track_fingerprint ?? null,
      cueIds: Array.isArray(row.evidence) ? row.evidence.flatMap((value) =>
        typeof value === "object" && value !== null && "cueId" in value && typeof value.cueId === "string" ? [value.cueId] : []
      ) : [],
      createdAt: row.created_at.toISOString(),
    }))),
  catch: () => new AdaptiveLearningError({ code: "storage_failed" }),
});

export const deleteAdaptiveMediaData = (userId: string) => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    const owner = userId as UserId;
    const now = new Date();
    const cards = await trx.selectFrom("srs_card").select(["id", "hlc"])
      .where("user_id", "=", owner).execute();
    const exercises = await trx.deleteFrom("generated_exercise").where("user_id", "=", owner).executeTakeFirst();
    const encounters = await trx.deleteFrom("media_encounter").where("user_id", "=", owner).executeTakeFirst();
    const checkouts = await trx.deleteFrom("media_checkout").where("user_id", "=", owner).executeTakeFirst();
    const events = await trx.deleteFrom("learner_progress_event").where("user_id", "=", owner).executeTakeFirst();
    const analyses = await trx.deleteFrom("media_analysis_run").where("user_id", "=", owner).executeTakeFirst();
    for (const card of cards) {
      await trx.updateTable("srs_card").set({
        checkout_due: false,
        updated_at: now,
        hlc: packHlc(receiveHlc(initHlc("server-adaptive-delete", now.getTime()), card.hlc, now.getTime())),
      }).where("id", "=", card.id).execute();
    }
    return {
      deletedExerciseCount: Number(exercises.numDeletedRows),
      deletedEncounterCount: Number(encounters.numDeletedRows),
      deletedCheckoutCount: Number(checkouts.numDeletedRows),
      deletedEventCount: Number(events.numDeletedRows),
      deletedAnalysisCount: Number(analyses.numDeletedRows),
    };
  }),
  catch: () => new AdaptiveLearningError({ code: "storage_failed" }),
});
