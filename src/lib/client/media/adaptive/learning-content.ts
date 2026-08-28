import { Effect } from "effect";
import type { LearningExerciseContent, PrimerContent } from "../../../server/ai/schema.ts";
import type { LearnerProgressEvent, NormalizedCue, NormalizedToken } from "../../../shared/adaptive-media.ts";
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
): Effect.Effect<SourceSimilarityDecision, Error> => Effect.gen(function* () {
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
  return decision;
});

export interface LearningEventRequest {
  readonly knowledgePointId: string;
  readonly candidateId: string | null;
  readonly event: Extract<LearnerProgressEvent,
    "primer_started" | "primer_retrieval_completed" | "cue_reached" | "checkout_recalled" | "checkout_missed" | "media_abandoned">;
  readonly idempotencyKey: string;
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
