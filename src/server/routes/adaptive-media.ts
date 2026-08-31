import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import {
  IntroductionAdmissionError,
  reserveIntroduction,
  setLearnerPointStatus,
} from "../../lib/server/IntroductionAdmissionService.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { analyzeMediaExcerpts } from "../../lib/server/ai/MediaAnalysisService.ts";
import {
  acceptMediaCandidate,
  markMediaCandidateKnown,
  MediaCandidateError,
  recordMediaCandidate,
  setMediaCandidateDisposition,
} from "../../lib/server/MediaCandidateService.ts";
import {
  completeAlternativeCheckout,
  deleteAdaptiveMediaData,
  listPendingMediaCheckouts,
  recordProgressEvent,
} from "../../lib/server/AdaptiveLearningService.ts";
import { generateExerciseContent, generatePrimerContent } from "../../lib/server/ai/LearningContentService.ts";
import {
  recordExerciseReview,
  selectValidatedExercise,
  storeValidatedExercise,
} from "../../lib/server/ExerciseBankService.ts";
import {
  AdaptiveMediaAdmissionDisabled,
  requireAdaptiveMediaAiAdmission,
} from "../../lib/server/AdaptiveMediaRelease.ts";
import { recordAdaptiveMediaMetric } from "../../lib/server/AdaptiveMediaMetrics.ts";

export const adaptiveMediaRoutes = new Elysia({ prefix: "/api/adaptive-media" })
  .use(effectPlugin)
  .post("/introductions/reserve", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      const reservation = yield* reserveIntroduction(user.id, body.knowledgePointId, body.idempotencyKey);
      yield* recordAdaptiveMediaMetric({ name: "capacity_decision", knowledgePointId: body.knowledgePointId, reason: reservation.reason });
      return reservation;
    });
    const result = await runEffect(Effect.either(program));
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 400;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Admission rejected" };
    }
    return result.right;
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      idempotencyKey: t.String({ minLength: 1, maxLength: 200 }),
    }),
  })
  .post("/progress/status", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* setLearnerPointStatus(user.id, body.knowledgePointId, body.action);
    });
    const result = await runEffect(Effect.either(program));
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 400;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Status update rejected" };
    }
    return result.right;
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      action: t.Union([t.Literal("mark_known"), t.Literal("archive"), t.Literal("reactivate")]),
    }),
  })
  .post("/analysis/recommendations", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      yield* validateToken(token);
      yield* requireAdaptiveMediaAiAdmission();
      const recommendations = yield* analyzeMediaExcerpts(body);
      yield* recordAdaptiveMediaMetric({
        name: "recommendation_completed",
        analysisRunId: body.analysisRunId,
        proposalCount: recommendations.proposals.length,
      });
      return recommendations;
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_media_analysis" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Media analysis unavailable" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      consent: t.Literal(true),
      analysisRunId: t.String({ minLength: 1, maxLength: 100 }),
      excerpts: t.Array(t.Object({
        cueId: t.String({ minLength: 1, maxLength: 220 }),
        text: t.String({ minLength: 1, maxLength: 280 }),
        startSeconds: t.Number({ minimum: 0 }),
      }), { minItems: 1, maxItems: 12 }),
    }),
  })
  .post("/candidates/action", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      if (body.action === "accept") {
        yield* requireAdaptiveMediaAiAdmission();
        const action = yield* acceptMediaCandidate(user.id, body.candidate, body.idempotencyKey);
        yield* recordAdaptiveMediaMetric({ name: "candidate_action", candidateId: body.candidate.id, action: body.action, accepted: action.accepted });
        return action;
      }
      if (body.action === "already_known") {
        yield* markMediaCandidateKnown(user.id, body.candidate);
        yield* recordAdaptiveMediaMetric({ name: "candidate_action", candidateId: body.candidate.id, action: body.action, accepted: false });
        return { accepted: false as const, reason: "already_known" as const };
      }
      const candidateId = yield* recordMediaCandidate(user.id, body.candidate);
      yield* setMediaCandidateDisposition(user.id, candidateId, body.action);
      yield* recordAdaptiveMediaMetric({ name: "candidate_action", candidateId: body.candidate.id, action: body.action, accepted: false });
      return { accepted: false as const, reason: body.action };
    });
    const result = await runEffect(Effect.either(program.pipe(
      Effect.tapError((error) => Effect.logWarning("[AdaptiveMedia] candidate_action_failed").pipe(
        Effect.annotateLogs({
          action: body.action,
          failureTag: error._tag,
          failureCode: error instanceof MediaCandidateError ? error.code : "none",
          cause: error instanceof IntroductionAdmissionError
            ? error.cause instanceof Error ? error.cause.message : String(error.cause)
            : "none",
        }),
      )),
    )), { name: "adaptive_media_candidate_action" });
    if (result._tag === "Left") {
      if (result.left instanceof InvalidCredentialsError) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (result.left instanceof AdaptiveMediaAdmissionDisabled) {
        set.status = 503;
        return { error: "Adaptive-media admission is currently disabled." };
      }
      if (result.left instanceof MediaCandidateError) {
        set.status = result.left.code === "invalid_candidate" ? 422 : 503;
        return {
          error: result.left.code === "invalid_candidate"
            ? "Candidate data was invalid; analyze the subtitles again."
            : "The candidate could not be saved; check the server log for the failure code.",
        };
      }
      set.status = 503;
      return { error: "The candidate could not be added to your learning bank; check the server log." };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      action: t.Union([
        t.Literal("accept"),
        t.Literal("already_known"),
        t.Literal("rejected"),
        t.Literal("not_useful"),
        t.Literal("wrongly_analyzed"),
      ]),
      idempotencyKey: t.String({ minLength: 1, maxLength: 200 }),
      candidate: t.Object({
        id: t.String({ format: "uuid" }),
        analysisRunId: t.String({ format: "uuid" }),
        subtitleTrackFingerprint: t.String({ minLength: 32, maxLength: 128 }),
        kind: t.Union([t.Literal("grammar"), t.Literal("vocabulary")]),
        canonicalKey: t.String({ minLength: 1, maxLength: 300 }),
        reading: t.Nullable(t.String({ maxLength: 200 })),
        meaning: t.String({ minLength: 1, maxLength: 600 }),
        confidence: t.Number({ minimum: 0, maximum: 1 }),
        reviewCostClass: t.Union([t.Literal("light_vocabulary"), t.Literal("difficult_vocabulary"), t.Literal("grammar")]),
        evidence: t.Array(t.Object({
          cueId: t.String({ minLength: 1, maxLength: 220 }),
          start: t.Number({ minimum: 0 }),
          end: t.Number({ minimum: 1 }),
        }), { minItems: 1, maxItems: 8 }),
        firstEncounterSeconds: t.Number({ minimum: 0 }),
        occurrenceCount: t.Number({ minimum: 1 }),
      }),
    }),
  })
  .post("/learning/content", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return body.mode === "primer"
        ? yield* generatePrimerContent(user.id, body.knowledgePointId)
        : yield* generateExerciseContent(user.id, body.knowledgePointId, body.mode);
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_learning_content" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 503;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Learning content unavailable" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      mode: t.Union([t.Literal("primer"), t.Literal("checkout"), t.Literal("review")]),
    }),
  })
  .post("/learning/event", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      const event = yield* recordProgressEvent(user.id, body);
      if (body.event === "checkout_recalled" || body.event === "checkout_missed") {
        yield* recordAdaptiveMediaMetric({
          name: "checkout_completed", knowledgePointId: body.knowledgePointId,
          outcome: body.event === "checkout_recalled" ? "recalled" : "missed",
        });
      }
      return event;
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_learning_event" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Learning event rejected" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      candidateId: t.Nullable(t.String({ format: "uuid" })),
      event: t.Union([
        t.Literal("primer_started"), t.Literal("primer_retrieval_completed"), t.Literal("cue_reached"),
        t.Literal("checkout_recalled"), t.Literal("checkout_missed"), t.Literal("media_abandoned"),
      ]),
      idempotencyKey: t.String({ minLength: 1, maxLength: 220 }),
      exerciseId: t.Optional(t.String({ format: "uuid" })),
      responseTimeMs: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
      encounter: t.Optional(t.Object({
        cueId: t.String({ minLength: 1, maxLength: 220 }),
        timingTransformId: t.String({ minLength: 1, maxLength: 220 }),
        effectivePlaybackSeconds: t.Number({ minimum: 0 }),
      })),
    }),
  })
  .get("/learning/checkouts", async ({ headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      const pending = yield* listPendingMediaCheckouts(user.id);
      yield* recordAdaptiveMediaMetric({ name: "queue_opened", pendingFreshCount: pending.length, freshOfferedCount: pending.length });
      return pending;
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_pending_checkouts" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 500;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Pending checkout lookup failed" };
    }
    return { success: true as const, data: result.right };
  })
  .post("/learning/checkout/alternative", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      yield* completeAlternativeCheckout(
        user.id, body.knowledgePointId, body.candidateId, body.outcome, body.canonicalDefinitionInvalid,
      );
      yield* recordAdaptiveMediaMetric({ name: "checkout_completed", knowledgePointId: body.knowledgePointId, outcome: body.outcome });
      return { completed: true as const };
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_alternative_checkout" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Checkout action rejected" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      candidateId: t.Nullable(t.String({ format: "uuid" })),
      outcome: t.Union([t.Literal("already_known"), t.Literal("wrongly_analyzed"), t.Literal("not_useful")]),
      canonicalDefinitionInvalid: t.Boolean(),
    }),
  })
  .post("/learning/exercises", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      const exercise = yield* storeValidatedExercise(user.id, body).pipe(Effect.tapError((error) =>
        recordAdaptiveMediaMetric({
          name: "exercise_validation", knowledgePointId: body.knowledgePointId,
          outcome: "rejected", reason: error.code,
        }).pipe(Effect.catchAll(() => Effect.void))
      ));
      yield* recordAdaptiveMediaMetric({ name: "exercise_validation", knowledgePointId: body.knowledgePointId, outcome: "accepted", reason: "accepted" });
      return exercise;
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_exercise_store" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Exercise validation rejected" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      id: t.String({ format: "uuid" }),
      knowledgePointId: t.String({ format: "uuid" }),
      content: t.Object({
        targetCanonicalKey: t.String({ minLength: 1 }),
        context: t.String({ minLength: 1 }),
        japaneseSentence: t.String({ minLength: 1 }),
        targetSurface: t.String({ minLength: 1 }),
        targetStart: t.Integer({ minimum: 0 }),
        targetEnd: t.Integer({ minimum: 1 }),
        answer: t.String({ minLength: 1 }),
        explanation: t.String({ minLength: 1 }),
        furigana: t.Array(t.Object({ text: t.String({ minLength: 1 }), reading: t.Optional(t.String()) }), { minItems: 1 }),
        modality: t.Union([t.Literal("text_recognition"), t.Literal("listening_recognition"), t.Literal("production")]),
        variationTags: t.Array(t.String({ minLength: 1 }), { minItems: 2, maxItems: 12 }),
        variationProfile: t.Object({
          situation: t.String({ minLength: 1 }),
          surroundingVocabulary: t.Array(t.String({ minLength: 1 }), { maxItems: 12 }),
          conjugation: t.String({ minLength: 1 }),
          politeness: t.Union([t.Literal("casual"), t.Literal("polite"), t.Literal("neutral")]),
          register: t.String({ minLength: 1 }),
          speakerIntention: t.String({ minLength: 1 }),
          polarity: t.Union([t.Literal("positive"), t.Literal("negative")]),
          questionForm: t.Boolean(),
        }),
        qualityChecks: t.Object({
          intendedSenseOrFunction: t.Literal(true),
          unambiguousAnswer: t.Literal(true),
          naturalJapanese: t.Literal(true),
          registerMatches: t.Literal(true),
        }),
        prerequisiteCanonicalKeys: t.Array(t.String({ minLength: 1 }), { maxItems: 20 }),
        confidence: t.Number({ minimum: 0, maximum: 1 }),
      }),
      sourceValidation: t.Object({
        signatureVersion: t.Literal("source_signature_v1"),
        normalizationVersion: t.Literal("adaptive_media_nfkc_v1"),
        semanticModelVersion: t.Literal("Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2"),
        decision: t.Literal("distinct"),
      }),
      generationMetadata: t.Optional(t.Object({
        promptVersion: t.Optional(t.String({ maxLength: 100 })),
        model: t.Optional(t.String({ maxLength: 200 })),
      })),
    }),
  })
  .get("/learning/exercises/:knowledgePointId/next", async ({ params, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* selectValidatedExercise(user.id, params.knowledgePointId);
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_exercise_select" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 404;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "No validated exercise available" };
    }
    return { success: true as const, data: result.right };
  }, {
    params: t.Object({ knowledgePointId: t.String({ format: "uuid" }) }),
  })
  .post("/learning/exercises/review", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      const review = yield* recordExerciseReview(
        user.id, body.exerciseId, body.recalled, body.idempotencyKey, body.responseTimeMs,
      );
      yield* recordAdaptiveMediaMetric({
        name: "mastery_review", knowledgePointId: review.knowledgePointId,
        recalled: body.recalled, variedContextCount: review.successfulMaterialContextCount,
        masteryLimited: review.masteryLimited,
      });
      return review;
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_exercise_review" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Exercise review rejected" };
    }
    return { success: true as const, data: result.right };
  }, {
    body: t.Object({
      exerciseId: t.String({ format: "uuid" }),
      recalled: t.Boolean(),
      idempotencyKey: t.String({ minLength: 1, maxLength: 220 }),
      responseTimeMs: t.Nullable(t.Integer({ minimum: 0 })),
    }),
  })
  .delete("/privacy/data", async ({ headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* deleteAdaptiveMediaData(user.id);
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_media_delete" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 500;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Adaptive-media deletion failed" };
    }
    return { success: true as const, data: result.right };
  });
