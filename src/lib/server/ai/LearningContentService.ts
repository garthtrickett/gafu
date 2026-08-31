import { Data, Effect } from "effect";
import { db } from "../../../db/client.ts";
import type { KnowledgePointId, UserId } from "../../../types/index.ts";
import {
  LearningExerciseContentSchema,
  PrimerContentSchema,
  type LearningExerciseContent,
  type PrimerContent,
} from "./schema.ts";

export interface LearningContentAgent {
  generate(prompt: string, options: { readonly structuredOutput: { readonly schema: typeof PrimerContentSchema | typeof LearningExerciseContentSchema } }): Promise<{ readonly object?: unknown }>;
}

export class LearningContentError extends Data.TaggedError("LearningContentError")<{
  readonly code: "point_not_found" | "service_unavailable" | "invalid_result";
}> {}

export interface GeneratedTargetSpan {
  readonly start: number;
  readonly end: number;
}

export const locateGeneratedTargetSpan = (
  sentence: string,
  targetSurface: string,
  reportedStart: number,
  reportedEnd: number,
): GeneratedTargetSpan | null => {
  if (!targetSurface || targetSurface.trim().length === 0) return null;
  if (
    reportedStart >= 0
    && reportedEnd > reportedStart
    && reportedEnd <= sentence.length
    && sentence.slice(reportedStart, reportedEnd) === targetSurface
  ) return { start: reportedStart, end: reportedEnd };
  const start = sentence.indexOf(targetSurface);
  return start >= 0 ? { start, end: start + targetSurface.length } : null;
};

const parsePrimerContent = (value: unknown) => {
  const parsed = PrimerContentSchema.safeParse(value);
  if (!parsed.success) return { success: false as const };
  const span = locateGeneratedTargetSpan(
    parsed.data.exampleSentence,
    parsed.data.exampleTargetSurface,
    parsed.data.exampleTargetStart,
    parsed.data.exampleTargetEnd,
  );
  if (!span) return { success: false as const };
  return {
    success: true as const,
    data: { ...parsed.data, exampleTargetStart: span.start, exampleTargetEnd: span.end },
  };
};

const parseExerciseContent = (value: unknown) => {
  const parsed = LearningExerciseContentSchema.safeParse(value);
  if (!parsed.success) return { success: false as const };
  const span = locateGeneratedTargetSpan(
    parsed.data.japaneseSentence,
    parsed.data.targetSurface,
    parsed.data.targetStart,
    parsed.data.targetEnd,
  );
  if (!span) return { success: false as const };
  return {
    success: true as const,
    data: { ...parsed.data, targetStart: span.start, targetEnd: span.end },
  };
};

const loadAgent = () => Effect.tryPromise({
  try: async () => {
    const { mastra } = await import("../../../../mastra.config.ts");
    return mastra.getAgentById("adaptive-learning-content") as LearningContentAgent | undefined;
  },
  catch: () => new LearningContentError({ code: "service_unavailable" }),
});

const targetContext = (userId: string, knowledgePointId: string) => Effect.tryPromise({
  try: async () => {
    const target = await db.selectFrom("knowledge_point")
      .leftJoin("grammar_point", "grammar_point.id", "knowledge_point.id")
      .leftJoin("vocabulary_point", "vocabulary_point.knowledge_point_id", "knowledge_point.id")
      .select([
        "knowledge_point.id", "knowledge_point.kind", "knowledge_point.canonical_key",
        "grammar_point.base_meaning", "vocabulary_point.lemma", "vocabulary_point.reading",
        "vocabulary_point.meaning", "vocabulary_point.part_of_speech",
      ])
      .where("knowledge_point.id", "=", knowledgePointId as KnowledgePointId)
      .where("knowledge_point.catalogue_status", "=", "active").executeTakeFirst();
    if (!target) throw new LearningContentError({ code: "point_not_found" });
    const prerequisites = await db.selectFrom("srs_card")
      .innerJoin("knowledge_point", "knowledge_point.id", "srs_card.knowledge_point_id")
      .select("knowledge_point.canonical_key")
      .where("srs_card.user_id", "=", userId as UserId)
      .where("srs_card.participation_status", "=", "active")
      .where("srs_card.learning_state", "in", ["stable", "known"])
      .limit(50).execute();
    const recentExercises = await db.selectFrom("generated_exercise")
      .select(["content_fingerprint", "variation_profile", "modality"])
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .where("validation_status", "=", "accepted")
      .orderBy("created_at", "desc").limit(10).execute();
    const recentEvidence = await db.selectFrom("retrieval_evidence")
      .select(["modality", "result", "material_context_key"])
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .orderBy("reviewed_at", "desc").limit(20).execute();
    return {
      contract: "adaptive_learning_content_v1",
      target: {
        kind: target.kind,
        canonicalKey: target.canonical_key,
        lemma: target.lemma,
        reading: target.reading,
        meaning: target.meaning ?? target.base_meaning,
        partOfSpeech: target.part_of_speech,
      },
      stablePrerequisiteCanonicalKeys: prerequisites.map((entry) => entry.canonical_key),
      recentExerciseFingerprints: recentExercises.map((entry) => entry.content_fingerprint),
      recentVariationHistory: recentExercises.map((entry) => ({
        modality: entry.modality,
        variationProfile: entry.variation_profile,
      })),
      performanceWeaknesses: recentEvidence
        .filter((entry) => entry.result === "missed")
        .map((entry) => ({ modality: entry.modality, materialContextKey: entry.material_context_key })),
      offsetUnit: "utf16_code_units",
      sourceExclusionPolicy: "source_signature_v1_client_validation_required",
    };
  },
  catch: (cause) => cause instanceof LearningContentError ? cause : new LearningContentError({ code: "service_unavailable" }),
});

const generate = <A>(
  userId: string,
  knowledgePointId: string,
  mode: "primer" | "checkout" | "review",
  schema: typeof PrimerContentSchema | typeof LearningExerciseContentSchema,
  parse: (value: unknown) => { readonly success: true; readonly data: A } | { readonly success: false },
  agentOverride?: LearningContentAgent,
): Effect.Effect<A, LearningContentError> => Effect.gen(function* () {
  const context = yield* targetContext(userId, knowledgePointId);
  const agent = agentOverride ?? (yield* loadAgent());
  if (!agent) return yield* Effect.fail(new LearningContentError({ code: "service_unavailable" }));
  yield* Effect.logInfo("[LearningContent] generation_started").pipe(Effect.annotateLogs({ knowledgePointId, mode }));
  const response = yield* Effect.tryPromise({
    try: () => agent.generate(JSON.stringify({ ...context, mode }), { structuredOutput: { schema } }),
    catch: () => new LearningContentError({ code: "service_unavailable" }),
  });
  const parsed = parse(response.object);
  if (!parsed.success) {
    yield* Effect.logWarning("[LearningContent] generation_rejected").pipe(Effect.annotateLogs({
      knowledgePointId,
      mode,
      reason: "invalid_or_unlocatable_target",
    }));
    return yield* Effect.fail(new LearningContentError({ code: "invalid_result" }));
  }
  yield* Effect.logInfo("[LearningContent] generation_completed").pipe(Effect.annotateLogs({ knowledgePointId, mode }));
  return parsed.data;
});

export const generatePrimerContent = (userId: string, knowledgePointId: string, agent?: LearningContentAgent): Effect.Effect<PrimerContent, LearningContentError> =>
  generate<PrimerContent>(userId, knowledgePointId, "primer", PrimerContentSchema, parsePrimerContent, agent);

export const generateExerciseContent = (userId: string, knowledgePointId: string, mode: "checkout" | "review", agent?: LearningContentAgent): Effect.Effect<LearningExerciseContent, LearningContentError> =>
  generate<LearningExerciseContent>(userId, knowledgePointId, mode, LearningExerciseContentSchema, parseExerciseContent, agent);
