import { Data, Effect } from "effect";
import { sql } from "kysely";
import { db } from "../../db/client.ts";
import type {
  GeneratedExerciseId,
  KnowledgePointId,
  UserId,
} from "../../types/index.ts";
import type { LearningExerciseContent } from "./ai/schema.ts";
import {
  NORMALIZED_CUE_VERSION,
  SOURCE_SEMANTIC_MODEL_VERSION,
  SOURCE_SIGNATURE_VERSION,
} from "../shared/adaptive-media.ts";
import {
  applyVariationMasteryLimit,
  calculateSrsUpdate,
  type SrsMetricsUpdate,
} from "../shared/srs-scheduling.ts";
import { initHlc, packHlc, receiveHlc } from "../shared/hlc.ts";

export class ExerciseBankError extends Data.TaggedError("ExerciseBankError")<{
  readonly code:
    | "point_not_found"
    | "schedule_not_found"
    | "exercise_not_found"
    | "invalid_source_attestation"
    | "invalid_target"
    | "invalid_furigana"
    | "unknown_prerequisite"
    | "quality_rejected"
    | "recent_duplicate"
    | "storage_failed";
}> {}

export interface SourceValidationAttestation {
  readonly signatureVersion: typeof SOURCE_SIGNATURE_VERSION;
  readonly normalizationVersion: typeof NORMALIZED_CUE_VERSION;
  readonly semanticModelVersion: typeof SOURCE_SEMANTIC_MODEL_VERSION;
  readonly decision: "distinct";
}

export interface StoreValidatedExerciseInput {
  readonly id: string;
  readonly knowledgePointId: string;
  readonly content: LearningExerciseContent;
  readonly sourceValidation: SourceValidationAttestation;
  readonly generationMetadata?: {
    readonly promptVersion?: string;
    readonly model?: string;
  };
}

export interface BankExercise {
  readonly id: string;
  readonly knowledgePointId: string;
  readonly content: LearningExerciseContent;
  readonly sourceValidation: SourceValidationAttestation;
  readonly validatedOnSourceDevice: true;
}

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, "");

const hex = (bytes: Uint8Array): string => [...bytes]
  .map((value) => value.toString(16).padStart(2, "0"))
  .join("");

const fingerprint = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
};

const characterBigrams = (value: string): ReadonlySet<string> => {
  const normalized = normalize(value);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
};

export const generatedExerciseSimilarity = (left: string, right: string): number => {
  const leftSet = characterBigrams(left);
  const rightSet = characterBigrams(right);
  if (leftSet.size === 0 || rightSet.size === 0) return normalize(left) === normalize(right) ? 1 : 0;
  let intersection = 0;
  for (const item of leftSet) if (rightSet.has(item)) intersection += 1;
  return (2 * intersection) / (leftSet.size + rightSet.size);
};

const exerciseFrame = (content: LearningExerciseContent): string => {
  const before = content.japaneseSentence.slice(0, content.targetStart);
  const target = content.japaneseSentence.slice(content.targetStart, content.targetEnd);
  const after = content.japaneseSentence.slice(content.targetEnd);
  const collapseContentWords = (value: string) => normalize(value)
    .replace(/[一-龯々〆ヵヶァ-ヶー]{1,}/gu, "◇")
    .replace(/◇+/g, "◇");
  return `${collapseContentWords(before)}<target:${normalize(target)}>${collapseContentWords(after)}`;
};

const materialContextValue = (content: LearningExerciseContent): string => JSON.stringify({
  modality: content.modality,
  conjugation: content.variationProfile.conjugation.normalize("NFKC").toLowerCase(),
  politeness: content.variationProfile.politeness,
  register: content.variationProfile.register.normalize("NFKC").toLowerCase(),
  speakerIntention: content.variationProfile.speakerIntention.normalize("NFKC").toLowerCase(),
  polarity: content.variationProfile.polarity,
  questionForm: content.variationProfile.questionForm,
});

const rowToExercise = (row: {
  id: unknown;
  knowledge_point_id: unknown;
  context: string;
  japanese_sentence: string;
  target_start: number;
  target_end: number;
  answer: string;
  explanation: string;
  furigana: unknown;
  modality: string;
  variation_tags: unknown;
  variation_profile: unknown;
  generation_metadata: unknown;
  source_signature_version: string;
  source_normalization_version: string;
  source_semantic_model_version: string;
}): BankExercise => {
  const metadata = typeof row.generation_metadata === "object" && row.generation_metadata !== null
    ? row.generation_metadata as { confidence?: unknown; targetCanonicalKey?: unknown; qualityChecks?: unknown; prerequisiteCanonicalKeys?: unknown }
    : {};
  return {
    id: String(row.id),
    knowledgePointId: String(row.knowledge_point_id),
    content: {
      targetCanonicalKey: typeof metadata.targetCanonicalKey === "string" ? metadata.targetCanonicalKey : "",
      context: row.context,
      japaneseSentence: row.japanese_sentence,
      targetStart: row.target_start,
      targetEnd: row.target_end,
      answer: row.answer,
      explanation: row.explanation,
      furigana: Array.isArray(row.furigana) ? row.furigana as LearningExerciseContent["furigana"] : [],
      modality: row.modality as LearningExerciseContent["modality"],
      variationTags: Array.isArray(row.variation_tags) ? row.variation_tags as string[] : [],
      variationProfile: row.variation_profile as LearningExerciseContent["variationProfile"],
      qualityChecks: metadata.qualityChecks as LearningExerciseContent["qualityChecks"],
      prerequisiteCanonicalKeys: Array.isArray(metadata.prerequisiteCanonicalKeys) ? metadata.prerequisiteCanonicalKeys as string[] : [],
      confidence: typeof metadata.confidence === "number" ? metadata.confidence : 1,
    },
    sourceValidation: {
      signatureVersion: row.source_signature_version as typeof SOURCE_SIGNATURE_VERSION,
      normalizationVersion: row.source_normalization_version as typeof NORMALIZED_CUE_VERSION,
      semanticModelVersion: row.source_semantic_model_version as typeof SOURCE_SEMANTIC_MODEL_VERSION,
      decision: "distinct",
    },
    validatedOnSourceDevice: true,
  };
};

export const storeValidatedExercise = (
  userId: string,
  input: StoreValidatedExerciseInput,
  now = new Date(),
): Effect.Effect<BankExercise, ExerciseBankError> => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    const replay = await trx.selectFrom("generated_exercise").selectAll()
      .where("id", "=", input.id as GeneratedExerciseId)
      .where("user_id", "=", userId as UserId).executeTakeFirst();
    if (replay) return rowToExercise(replay);
    if (
      input.sourceValidation.signatureVersion !== SOURCE_SIGNATURE_VERSION
      || input.sourceValidation.normalizationVersion !== NORMALIZED_CUE_VERSION
      || input.sourceValidation.semanticModelVersion !== SOURCE_SEMANTIC_MODEL_VERSION
      || input.sourceValidation.decision !== "distinct"
    ) throw new ExerciseBankError({ code: "invalid_source_attestation" });

    const schedule = await trx.selectFrom("srs_card").select("id")
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
      .where("participation_status", "=", "active").executeTakeFirst();
    if (!schedule) throw new ExerciseBankError({ code: "schedule_not_found" });
    const point = await trx.selectFrom("knowledge_point").select("canonical_key")
      .where("id", "=", input.knowledgePointId as KnowledgePointId)
      .where("catalogue_status", "=", "active").executeTakeFirst();
    if (!point) throw new ExerciseBankError({ code: "point_not_found" });

    const content = input.content;
    if (
      content.targetCanonicalKey !== point.canonical_key
      || content.targetStart < 0
      || content.targetEnd <= content.targetStart
      || content.targetEnd > content.japaneseSentence.length
      || content.japaneseSentence.slice(content.targetStart, content.targetEnd).trim().length === 0
    ) throw new ExerciseBankError({ code: "invalid_target" });
    if (content.furigana.length === 0 || content.furigana.map((segment) => segment.text).join("") !== content.japaneseSentence) {
      throw new ExerciseBankError({ code: "invalid_furigana" });
    }
    if (content.confidence < 0.75 || Object.values(content.qualityChecks).some((passed) => passed !== true)) {
      throw new ExerciseBankError({ code: "quality_rejected" });
    }

    const prerequisiteRows = content.prerequisiteCanonicalKeys.length === 0 ? [] : await trx
      .selectFrom("srs_card")
      .innerJoin("knowledge_point", "knowledge_point.id", "srs_card.knowledge_point_id")
      .select(["knowledge_point.id", "knowledge_point.canonical_key"])
      .where("srs_card.user_id", "=", userId as UserId)
      .where("srs_card.participation_status", "=", "active")
      .where("srs_card.learning_state", "in", ["stable", "known"])
      .where("knowledge_point.canonical_key", "in", content.prerequisiteCanonicalKeys)
      .execute();
    if (new Set(prerequisiteRows.map((row) => row.canonical_key)).size !== new Set(content.prerequisiteCanonicalKeys).size) {
      throw new ExerciseBankError({ code: "unknown_prerequisite" });
    }

    const contentFingerprint = await fingerprint(normalize(content.japaneseSentence));
    const frameFingerprint = await fingerprint(exerciseFrame(content));
    const materialContextKey = await fingerprint(materialContextValue(content));
    const recent = await trx.selectFrom("generated_exercise")
      .select(["japanese_sentence", "content_fingerprint", "frame_fingerprint", "material_context_key"])
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", input.knowledgePointId as KnowledgePointId)
      .where("validation_status", "=", "accepted")
      .orderBy("created_at", "desc").limit(20).execute();
    if (recent.some((row) =>
      row.content_fingerprint === contentFingerprint
      || row.frame_fingerprint === frameFingerprint
      || generatedExerciseSimilarity(row.japanese_sentence, content.japaneseSentence) >= 0.82
      || (row.material_context_key === materialContextKey
        && generatedExerciseSimilarity(row.japanese_sentence, content.japaneseSentence) >= 0.65)
    )) throw new ExerciseBankError({ code: "recent_duplicate" });

    await trx.insertInto("generated_exercise").values({
      id: input.id as GeneratedExerciseId,
      user_id: userId as UserId,
      knowledge_point_id: input.knowledgePointId as KnowledgePointId,
      context: content.context,
      japanese_sentence: content.japaneseSentence,
      target_start: content.targetStart,
      target_end: content.targetEnd,
      answer: content.answer,
      explanation: content.explanation,
      furigana: sql`${JSON.stringify(content.furigana)}::jsonb`,
      modality: content.modality,
      variation_tags: sql`${JSON.stringify(content.variationTags)}::jsonb`,
      variation_profile: sql`${JSON.stringify(content.variationProfile)}::jsonb`,
      prerequisite_ids: sql`${JSON.stringify(prerequisiteRows.map((row) => row.id))}::jsonb`,
      source_signature_version: input.sourceValidation.signatureVersion,
      source_normalization_version: input.sourceValidation.normalizationVersion,
      source_semantic_model_version: input.sourceValidation.semanticModelVersion,
      validation_status: "accepted",
      generation_metadata: sql`${JSON.stringify({
        promptVersion: input.generationMetadata?.promptVersion ?? "adaptive_learning_content_v1",
        model: input.generationMetadata?.model ?? "server-configured",
        confidence: content.confidence,
        targetCanonicalKey: content.targetCanonicalKey,
        qualityChecks: content.qualityChecks,
        prerequisiteCanonicalKeys: content.prerequisiteCanonicalKeys,
      })}::jsonb`,
      content_fingerprint: contentFingerprint,
      frame_fingerprint: frameFingerprint,
      material_context_key: materialContextKey,
      created_at: now,
      updated_at: now,
    }).execute();
    const stored = await trx.selectFrom("generated_exercise").selectAll()
      .where("id", "=", input.id as GeneratedExerciseId).executeTakeFirstOrThrow();
    return rowToExercise(stored);
  }),
  catch: (cause) => cause instanceof ExerciseBankError ? cause : new ExerciseBankError({ code: "storage_failed" }),
});

export const selectValidatedExercise = (
  userId: string,
  knowledgePointId: string,
  now = new Date(),
): Effect.Effect<BankExercise, ExerciseBankError> => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    const rows = await trx.selectFrom("generated_exercise").selectAll()
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .where("validation_status", "=", "accepted").execute();
    if (rows.length === 0) throw new ExerciseBankError({ code: "exercise_not_found" });
    const evidence = await trx.selectFrom("retrieval_evidence")
      .select(["modality", "material_context_key", "result"])
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", knowledgePointId as KnowledgePointId)
      .orderBy("reviewed_at", "desc").limit(40).execute();
    const missedByModality = new Map<string, number>();
    const successfulContexts = new Set<string>();
    for (const item of evidence) {
      if (item.result === "missed") missedByModality.set(item.modality, (missedByModality.get(item.modality) ?? 0) + 1);
      else successfulContexts.add(item.material_context_key);
    }
    const selected = [...rows].sort((left, right) => {
      const leftWeakness = missedByModality.get(left.modality) ?? 0;
      const rightWeakness = missedByModality.get(right.modality) ?? 0;
      if (leftWeakness !== rightWeakness) return rightWeakness - leftWeakness;
      const leftNovel = successfulContexts.has(left.material_context_key) ? 0 : 1;
      const rightNovel = successfulContexts.has(right.material_context_key) ? 0 : 1;
      if (leftNovel !== rightNovel) return rightNovel - leftNovel;
      if (left.use_count !== right.use_count) return left.use_count - right.use_count;
      return (left.last_used_at?.getTime() ?? 0) - (right.last_used_at?.getTime() ?? 0);
    })[0]!;
    await trx.updateTable("generated_exercise").set({
      use_count: sql<number>`${sql.ref("use_count")} + 1`,
      last_used_at: now,
      updated_at: now,
    }).where("id", "=", selected.id).execute();
    return rowToExercise(selected);
  }),
  catch: (cause) => cause instanceof ExerciseBankError ? cause : new ExerciseBankError({ code: "storage_failed" }),
});

export interface ExerciseReviewResult {
  readonly replayed: boolean;
  readonly successfulMaterialContextCount: number;
  readonly masteryLimited: boolean;
  readonly metrics: SrsMetricsUpdate;
  readonly learningState: "learning" | "stable";
}

export const recordExerciseReview = (
  userId: string,
  exerciseId: string,
  recalled: boolean,
  idempotencyKey: string,
  responseTimeMs: number | null,
  now = new Date(),
): Effect.Effect<ExerciseReviewResult, ExerciseBankError> => Effect.tryPromise({
  try: () => db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${exerciseId}`}))`.execute(trx);
    const replay = await trx.selectFrom("retrieval_evidence").select("scheduling_change")
      .where("user_id", "=", userId as UserId).where("idempotency_key", "=", idempotencyKey).executeTakeFirst();
    if (replay) return { ...(replay.scheduling_change as ExerciseReviewResult), replayed: true };
    const exercise = await trx.selectFrom("generated_exercise").selectAll()
      .where("id", "=", exerciseId as GeneratedExerciseId)
      .where("user_id", "=", userId as UserId).executeTakeFirst();
    if (!exercise) throw new ExerciseBankError({ code: "exercise_not_found" });
    const progress = await trx.selectFrom("srs_card").selectAll()
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", exercise.knowledge_point_id).executeTakeFirst();
    if (!progress) throw new ExerciseBankError({ code: "schedule_not_found" });
    const priorContexts = recalled ? await trx.selectFrom("retrieval_evidence")
      .select("material_context_key").distinct()
      .where("user_id", "=", userId as UserId)
      .where("knowledge_point_id", "=", exercise.knowledge_point_id)
      .where("result", "=", "recalled").execute() : [];
    const contexts = new Set(priorContexts.map((row) => row.material_context_key));
    if (recalled) contexts.add(exercise.material_context_key);
    const unrestricted = calculateSrsUpdate({
      easeFactor: progress.ease_factor,
      repetitions: progress.repetitions,
      intervalDays: progress.interval_days,
      difficulty: Number(progress.difficulty),
      stability: Number(progress.stability),
    }, recalled, now, () => 0.5);
    const metrics = applyVariationMasteryLimit(unrestricted, contexts.size, now);
    const masteryLimited = metrics.intervalDays !== unrestricted.intervalDays;
    const learningState = recalled && contexts.size >= 2 && metrics.stability >= 7 ? "stable" as const : "learning" as const;
    const result: ExerciseReviewResult = {
      replayed: false,
      successfulMaterialContextCount: contexts.size,
      masteryLimited,
      metrics,
      learningState,
    };
    await trx.insertInto("retrieval_evidence").values({
      user_id: userId as UserId,
      knowledge_point_id: exercise.knowledge_point_id,
      exercise_id: exercise.id,
      result: recalled ? "recalled" : "missed",
      response_time_ms: responseTimeMs,
      modality: exercise.modality,
      material_context_key: exercise.material_context_key,
      scheduling_change: sql`${JSON.stringify(result)}::jsonb`,
      idempotency_key: idempotencyKey,
      reviewed_at: now,
    }).execute();
    await trx.updateTable("srs_card").set({
      learning_state: learningState,
      ease_factor: metrics.easeFactor,
      repetitions: metrics.repetitions,
      interval_days: metrics.intervalDays,
      difficulty: metrics.difficulty,
      stability: metrics.stability,
      last_reviewed_at: new Date(metrics.lastReviewedAt),
      next_review: new Date(metrics.nextReview),
      updated_at: now,
      hlc: packHlc(receiveHlc(initHlc("server-adaptive", now.getTime()), progress.hlc, now.getTime())),
    }).where("id", "=", progress.id).execute();
    return result;
  }),
  catch: (cause) => cause instanceof ExerciseBankError ? cause : new ExerciseBankError({ code: "storage_failed" }),
});
