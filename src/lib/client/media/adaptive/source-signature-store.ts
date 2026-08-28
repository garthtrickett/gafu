import { Effect } from "effect";
import { createStore, get, set } from "idb-keyval";
import { NORMALIZED_CUE_VERSION, SOURCE_SIGNATURE_VERSION, type NormalizedCue } from "../../../shared/adaptive-media.ts";
import {
  SEMANTIC_MODEL_VERSION,
  exactSourceHash,
  keyedLexicalSketch,
  semanticSimHash,
  type SourceExclusionSignatures,
} from "./source-signatures.ts";
import { embedSentencesLocally } from "./semantic-embedder.ts";

const privateStore = createStore("gafu-adaptive-media-private-v1", "source-signatures");
const DEVICE_KEY = "device-hmac-key-v1";

interface PersistedSignatures {
  readonly version: typeof SOURCE_SIGNATURE_VERSION;
  readonly normalizationVersion: typeof NORMALIZED_CUE_VERSION;
  readonly semanticModelVersion: typeof SEMANTIC_MODEL_VERSION;
  readonly exact: readonly string[];
  readonly lexical: readonly (readonly number[])[];
  readonly semantic: readonly (readonly number[])[];
}

export const getOrCreateSourceSignatureKey = () => Effect.gen(function* () {
  const existing = yield* Effect.tryPromise({
    try: () => get<number[]>(DEVICE_KEY, privateStore),
    catch: (cause) => new Error(`Could not read device source-signature key: ${String(cause)}`),
  });
  if (existing?.length === 32) return Uint8Array.from(existing);
  const generated = crypto.getRandomValues(new Uint8Array(32));
  yield* Effect.tryPromise({
    try: () => set(DEVICE_KEY, [...generated], privateStore),
    catch: (cause) => new Error(`Could not persist device source-signature key: ${String(cause)}`),
  });
  return generated;
});

export const buildSourceExclusionSignatures = (
  cues: readonly NormalizedCue[],
  deviceKey: Uint8Array,
) => Effect.gen(function* () {
  const rows = yield* Effect.forEach(cues, (cue) => Effect.all({
    exact: exactSourceHash(cue.normalizedText),
    lexical: keyedLexicalSketch(cue.tokens, deviceKey),
  }), { concurrency: 4 });
  return {
    version: SOURCE_SIGNATURE_VERSION,
    normalizationVersion: NORMALIZED_CUE_VERSION,
    semanticModelVersion: SEMANTIC_MODEL_VERSION,
    exact: new Set(rows.map((row) => row.exact)),
    lexical: rows.map((row) => row.lexical),
    // Filled by the pinned local embedder before Phase 4 exercises are admitted.
    // An empty set causes semantic validation to fail closed.
    semantic: [],
  } satisfies SourceExclusionSignatures;
});

export const enrichSourceSemanticSignatures = (
  cues: readonly NormalizedCue[],
  signatures: SourceExclusionSignatures,
  embedder: (texts: readonly string[]) => Effect.Effect<readonly ArrayLike<number>[], Error> = embedSentencesLocally,
) => Effect.map(
  embedder(cues.map((cue) => cue.normalizedText)),
  (embeddings): SourceExclusionSignatures => ({
    ...signatures,
    semantic: embeddings.map(semanticSimHash),
  }),
);

export const persistSourceExclusionSignatures = (
  subtitleTrackFingerprint: string,
  signatures: SourceExclusionSignatures,
) => Effect.tryPromise({
  try: () => set(`track:${subtitleTrackFingerprint}`, {
    version: signatures.version,
    normalizationVersion: signatures.normalizationVersion,
    semanticModelVersion: signatures.semanticModelVersion,
    exact: [...signatures.exact],
    lexical: signatures.lexical.map((value) => [...value]),
    semantic: signatures.semantic.map((value) => [...value]),
  } satisfies PersistedSignatures, privateStore),
  catch: (cause) => new Error(`Could not persist private source signatures: ${String(cause)}`),
});

export const loadSourceExclusionSignatures = (subtitleTrackFingerprint: string) => Effect.map(
  Effect.tryPromise({
    try: () => get<PersistedSignatures>(`track:${subtitleTrackFingerprint}`, privateStore),
    catch: (cause) => new Error(`Could not load private source signatures: ${String(cause)}`),
  }),
  (persisted): SourceExclusionSignatures | null => persisted ? ({
    version: persisted.version,
    normalizationVersion: persisted.normalizationVersion,
    semanticModelVersion: persisted.semanticModelVersion,
    exact: new Set(persisted.exact),
    lexical: persisted.lexical.map((value) => Uint32Array.from(value)),
    semantic: persisted.semantic.map((value) => Uint32Array.from(value)),
  }) : null,
);
