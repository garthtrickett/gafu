import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import { reserveIntroduction, setLearnerPointStatus } from "../../lib/server/IntroductionAdmissionService.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { analyzeMediaExcerpts } from "../../lib/server/ai/MediaAnalysisService.ts";
import {
  acceptMediaCandidate,
  markMediaCandidateKnown,
  recordMediaCandidate,
  setMediaCandidateDisposition,
} from "../../lib/server/MediaCandidateService.ts";
import {
  completeAlternativeCheckout,
  listPendingMediaCheckouts,
  recordProgressEvent,
} from "../../lib/server/AdaptiveLearningService.ts";
import { generateExerciseContent, generatePrimerContent } from "../../lib/server/ai/LearningContentService.ts";

export const adaptiveMediaRoutes = new Elysia({ prefix: "/api/adaptive-media" })
  .use(effectPlugin)
  .post("/introductions/reserve", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* reserveIntroduction(user.id, body.knowledgePointId, body.idempotencyKey);
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
      return yield* analyzeMediaExcerpts(body);
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
        return yield* acceptMediaCandidate(user.id, body.candidate, body.idempotencyKey);
      }
      if (body.action === "already_known") {
        yield* markMediaCandidateKnown(user.id, body.candidate);
        return { accepted: false as const, reason: "already_known" as const };
      }
      const candidateId = yield* recordMediaCandidate(user.id, body.candidate);
      yield* setMediaCandidateDisposition(user.id, candidateId, body.action);
      return { accepted: false as const, reason: body.action };
    });
    const result = await runEffect(Effect.either(program), { name: "adaptive_media_candidate_action" });
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 422;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Candidate action rejected" };
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
      return yield* recordProgressEvent(user.id, body);
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
      return yield* listPendingMediaCheckouts(user.id);
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
  });
