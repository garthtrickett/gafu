import { Effect } from "effect";
import { createStore, get, set } from "idb-keyval";
import type { LearningExerciseContent, PrimerContent } from "../../../server/ai/schema.ts";
import {
  NORMALIZED_CUE_VERSION,
  SOURCE_SEMANTIC_MODEL_VERSION,
  SOURCE_SIGNATURE_VERSION,
  type LearnerProgressEvent,
  type NormalizedCue,
  type NormalizedToken,
} from "../../../shared/adaptive-media.ts";
import { embedSentencesLocally } from "./semantic-embedder.ts";
import {
  enrichSourceSemanticSignatures,
  getOrCreateSourceSignatureKey,
  loadSourceExclusionSignatures,
  persistSourceExclusionSignatures,
} from "./source-signature-store.ts";
import {
  evaluateSourceSimilarity,
  exactSourceHash,
  keyedLexicalSketch,
  semanticSimHash,
  type SourceSimilarityDecision,
} from "./source-signatures.ts";
import { tokenizeJapaneseWithFallback } from "./tokenizer.ts";

export type LearningContentMode = "primer" | "checkout" | "review";

export interface SourceValidationAttestation {
  readonly signatureVersion: typeof SOURCE_SIGNATURE_VERSION;
  readonly normalizationVersion: typeof NORMALIZED_CUE_VERSION;
  readonly semanticModelVersion: typeof SOURCE_SEMANTIC_MODEL_VERSION;
  readonly decision: "distinct";
}

export interface ValidatedSourceDecision extends SourceSimilarityDecision {
  readonly attestation: SourceValidationAttestation;
}

export interface ValidatedBankExercise {
  readonly id: string;
  readonly knowledgePointId: string;
  readonly content: LearningExerciseContent;
  readonly sourceValidation: SourceValidationAttestation;
  readonly validatedOnSourceDevice: true;
}

const exerciseCache = createStore("gafu-adaptive-exercise-cache-v1", "validated-exercises");

const cacheValidatedExercise = (exercise: ValidatedBankExercise) => Effect.tryPromise({
  try: () => set(`point:${exercise.knowledgePointId}`, exercise, exerciseCache),
  catch: () => new Error("Validated exercise could not be cached locally."),
});

const loadCachedValidatedExercise = (knowledgePointId: string): Effect.Effect<ValidatedBankExercise, Error> => Effect.gen(function* () {
  const exercise = yield* Effect.tryPromise({
    try: () => get<ValidatedBankExercise>(`point:${knowledgePointId}`, exerciseCache),
    catch: () => new Error("Local validated exercise cache is unavailable."),
  });
  if (!exercise?.validatedOnSourceDevice) return yield* Effect.fail(new Error("No validated cached exercise is available; the point remains due."));
  return exercise;
});

export function requestLearningContent(token: string, knowledgePointId: string, mode: "primer"): Effect.Effect<PrimerContent, Error>;
export function requestLearningContent(token: string, knowledgePointId: string, mode: "checkout" | "review"): Effect.Effect<LearningExerciseContent, Error>;
export function requestLearningContent(token: string, knowledgePointId: string, mode: LearningContentMode): Effect.Effect<PrimerContent | LearningExerciseContent, Error> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch("/api/adaptive-media/learning/content", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ knowledgePointId, mode }),
      }),
      catch: () => new Error("Learning content service is unreachable."),
    });
    if (!response.ok) return yield* Effect.fail(new Error("Learning content is unavailable; playback remains available."));
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: PrimerContent | LearningExerciseContent }>,
      catch: () => new Error("Learning content returned unreadable data."),
    });
    if (!payload.success || !payload.data) return yield* Effect.fail(new Error("Learning content returned invalid data."));
    return payload.data;
  });
}

export const validateGeneratedSentence = (
  sentence: string,
  targetStart: number,
  targetEnd: number,
  cues: readonly NormalizedCue[],
  subtitleTrackFingerprint: string,
  embedder: (texts: readonly string[]) => Effect.Effect<readonly ArrayLike<number>[], Error> = embedSentencesLocally,
  tokenizer: (text: string) => Effect.Effect<readonly NormalizedToken[], Error> = tokenizeJapaneseWithFallback,
): Effect.Effect<ValidatedSourceDecision, Error> => Effect.gen(function* () {
  if (targetStart < 0 || targetEnd <= targetStart || targetEnd > sentence.length || sentence.slice(targetStart, targetEnd).trim().length === 0) {
    return yield* Effect.fail(new Error("Generated target span is invalid."));
  }
  let source = yield* loadSourceExclusionSignatures(subtitleTrackFingerprint);
  if (!source) return yield* Effect.fail(new Error("Original source signatures are unavailable on this device."));
  if (source.semantic.length === 0) {
    source = yield* enrichSourceSemanticSignatures(cues, source, embedder);
    yield* persistSourceExclusionSignatures(subtitleTrackFingerprint, source);
  }
  const tokens = yield* tokenizer(sentence);
  const key = yield* getOrCreateSourceSignatureKey();
  const embeddings = yield* embedder([sentence]);
  const semantic = embeddings[0] ? semanticSimHash(embeddings[0]) : null;
  const decision = evaluateSourceSimilarity(
    yield* exactSourceHash(sentence),
    yield* keyedLexicalSketch(tokens, key),
    semantic,
    source,
  );
  if (!decision.displayable) return yield* Effect.fail(new Error(`Generated content rejected by source exclusion (${decision.reason}).`));
  return {
    ...decision,
    attestation: {
      signatureVersion: SOURCE_SIGNATURE_VERSION,
      normalizationVersion: NORMALIZED_CUE_VERSION,
      semanticModelVersion: SOURCE_SEMANTIC_MODEL_VERSION,
      decision: "distinct",
    },
  };
});

export const storeValidatedLearningExercise = (
  token: string,
  knowledgePointId: string,
  content: LearningExerciseContent,
  sourceValidation: SourceValidationAttestation,
  id = crypto.randomUUID(),
): Effect.Effect<ValidatedBankExercise, Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/learning/exercises", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, knowledgePointId, content, sourceValidation }),
    }),
    catch: () => new Error("Validated exercise could not be stored."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Generated exercise did not pass bank validation."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: ValidatedBankExercise }>,
    catch: () => new Error("Exercise-bank response was unreadable."),
  });
  if (!payload.success || !payload.data) return yield* Effect.fail(new Error("Exercise bank returned invalid data."));
  yield* cacheValidatedExercise(payload.data).pipe(Effect.catchAll(() => Effect.void));
  return payload.data;
});

export const fetchNextValidatedExercise = (
  token: string,
  knowledgePointId: string,
): Effect.Effect<ValidatedBankExercise, Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch(`/api/adaptive-media/learning/exercises/${knowledgePointId}/next`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    catch: () => new Error("Exercise bank is unreachable."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("No previously validated exercise is available; the point remains due."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: ValidatedBankExercise }>,
    catch: () => new Error("Exercise-bank response was unreadable."),
  });
  if (!payload.success || !payload.data?.validatedOnSourceDevice) {
    return yield* Effect.fail(new Error("No source-validated cached exercise is available; the point remains due."));
  }
  yield* cacheValidatedExercise(payload.data).pipe(Effect.catchAll(() => Effect.void));
  return payload.data;
}).pipe(Effect.catchAll(() => loadCachedValidatedExercise(knowledgePointId)));

export const generateValidateAndStoreExercise = (
  token: string,
  knowledgePointId: string,
  mode: "checkout" | "review",
  cues: readonly NormalizedCue[],
  subtitleTrackFingerprint: string,
): Effect.Effect<ValidatedBankExercise, Error> => Effect.gen(function* () {
  const content = yield* requestLearningContent(token, knowledgePointId, mode);
  const validation = yield* validateGeneratedSentence(
    content.japaneseSentence,
    content.targetStart,
    content.targetEnd,
    cues,
    subtitleTrackFingerprint,
  );
  return yield* storeValidatedLearningExercise(token, knowledgePointId, content, validation.attestation);
});

export const requestExerciseWithCachedFallback = (
  token: string,
  knowledgePointId: string,
  mode: "checkout" | "review",
  cues: readonly NormalizedCue[],
  subtitleTrackFingerprint: string,
): Effect.Effect<{ readonly exercise: ValidatedBankExercise; readonly cached: boolean }, Error> => Effect.catchAll(
  Effect.map(
    generateValidateAndStoreExercise(token, knowledgePointId, mode, cues, subtitleTrackFingerprint),
    (exercise) => ({ exercise, cached: false as const }),
  ),
  () => Effect.map(fetchNextValidatedExercise(token, knowledgePointId), (exercise) => ({ exercise, cached: true as const })),
);

export const submitExerciseReview = (
  token: string,
  exerciseId: string,
  recalled: boolean,
  idempotencyKey: string,
  responseTimeMs: number | null,
): Effect.Effect<{
  readonly replayed: boolean;
  readonly successfulMaterialContextCount: number;
  readonly masteryLimited: boolean;
  readonly metrics: {
    readonly easeFactor: number;
    readonly repetitions: number;
    readonly intervalDays: number;
    readonly difficulty: number;
    readonly stability: number;
    readonly lastReviewedAt: string;
    readonly nextReview: string;
  };
  readonly learningState: "learning" | "stable";
}, Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/learning/exercises/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ exerciseId, recalled, idempotencyKey, responseTimeMs }),
    }),
    catch: () => new Error("Exercise result could not be synchronized."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Exercise result was rejected; the point remains due."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: {
      readonly replayed: boolean;
      readonly successfulMaterialContextCount: number;
      readonly masteryLimited: boolean;
      readonly metrics: {
        readonly easeFactor: number;
        readonly repetitions: number;
        readonly intervalDays: number;
        readonly difficulty: number;
        readonly stability: number;
        readonly lastReviewedAt: string;
        readonly nextReview: string;
      };
      readonly learningState: "learning" | "stable";
    } }>,
    catch: () => new Error("Exercise result response was unreadable."),
  });
  if (!payload.success || !payload.data) return yield* Effect.fail(new Error("Exercise result response was invalid."));
  return payload.data;
});

export interface LearningEventRequest {
  readonly knowledgePointId: string;
  readonly candidateId: string | null;
  readonly event: Extract<LearnerProgressEvent,
    "primer_started" | "primer_retrieval_completed" | "cue_reached" | "checkout_recalled" | "checkout_missed" | "media_abandoned">;
  readonly idempotencyKey: string;
  readonly exerciseId?: string;
  readonly responseTimeMs?: number | null;
  readonly encounter?: { readonly cueId: string; readonly timingTransformId: string; readonly effectivePlaybackSeconds: number };
}

export const submitLearningEvent = (token: string, event: LearningEventRequest) => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/learning/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    }),
    catch: () => new Error("Learning event could not be synchronized."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Learning event was rejected."));
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new Error("Learning event response was unreadable."),
  });
});

export interface PendingMediaCheckout {
  readonly id: string;
  readonly knowledgePointId: string;
  readonly candidateId: string | null;
  readonly kind: "grammar" | "vocabulary";
  readonly canonicalKey: string;
  readonly reading: string;
  readonly meaning: string;
  readonly learningState: string;
  readonly subtitleTrackFingerprint: string | null;
  readonly cueIds: readonly string[];
  readonly createdAt: string;
}

export const fetchPendingMediaCheckouts = (token: string): Effect.Effect<readonly PendingMediaCheckout[], Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/learning/checkouts", { headers: { Authorization: `Bearer ${token}` } }),
    catch: () => new Error("Pending checkout lookup is unavailable."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Pending checkout lookup failed."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: readonly PendingMediaCheckout[] }>,
    catch: () => new Error("Pending checkout response was unreadable."),
  });
  return payload.success && payload.data ? payload.data : [];
});

export const submitAlternativeCheckout = (
  token: string,
  checkout: PendingMediaCheckout,
  outcome: "already_known" | "wrongly_analyzed" | "not_useful",
  canonicalDefinitionInvalid = false,
) => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/learning/checkout/alternative", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ knowledgePointId: checkout.knowledgePointId, candidateId: checkout.candidateId, outcome, canonicalDefinitionInvalid }),
    }),
    catch: () => new Error("Checkout action could not be synchronized."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Checkout action was rejected."));
});
