import { Effect } from "effect";
import { SOURCE_SEMANTIC_MODEL_VERSION, SOURCE_SIGNATURE_VERSION, type NormalizedToken } from "../../../shared/adaptive-media.ts";

export const LEXICAL_SIGNATURE_SIZE = 32;
export const SEMANTIC_SIGNATURE_BITS = 128;
export const SEMANTIC_MODEL_VERSION = SOURCE_SEMANTIC_MODEL_VERSION;
export const LEXICAL_REJECTION_THRESHOLD = 0.72;
export const SEMANTIC_REJECTION_THRESHOLD = 0.88;

const fnv1a = (value: string, seed = 2_166_136_261): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const normalizedLexemes = (tokens: readonly NormalizedToken[]): string[] => tokens
  .filter((token) => !token.punctuation && !token.lineBreak)
  .map((token) => `${token.lemma.normalize("NFKC").toLowerCase()}:${token.partOfSpeech[0] ?? "unknown"}`);

const shingles = (tokens: readonly NormalizedToken[]): string[] => {
  const lexemes = normalizedLexemes(tokens);
  const result = new Set<string>();
  for (let width = 1; width <= 3; width += 1) {
    for (let index = 0; index <= lexemes.length - width; index += 1) result.add(lexemes.slice(index, index + width).join("\u001f"));
  }
  return [...result];
};

const unkeyedLexicalMinHash = (tokens: readonly NormalizedToken[]): Uint32Array => {
  const features = shingles(tokens);
  const signature = new Uint32Array(LEXICAL_SIGNATURE_SIZE);
  signature.fill(0xffff_ffff);
  for (let slot = 0; slot < signature.length; slot += 1) {
    const seed = fnv1a(`source_signature_v1:${slot}`);
    for (const feature of features) signature[slot] = Math.min(signature[slot]!, fnv1a(feature, seed));
  }
  return signature;
};

export const keyedLexicalSketch = (tokens: readonly NormalizedToken[], deviceKey: Uint8Array) => Effect.tryPromise({
  try: async () => {
    const key = await crypto.subtle.importKey("raw", deviceKey as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const values = await Promise.all(shingles(tokens).map(async (feature) => {
      const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(feature));
      return new DataView(digest).getUint32(0, false);
    }));
    const bottom = [...new Set(values)].sort((left, right) => left - right).slice(0, LEXICAL_SIGNATURE_SIZE);
    const signature = new Uint32Array(LEXICAL_SIGNATURE_SIZE);
    signature.fill(0xffff_ffff);
    signature.set(bottom);
    return signature;
  },
  catch: (cause) => new Error(`Could not calculate keyed lexical sketch: ${String(cause)}`),
});

export const lexicalSimilarity = (left: Uint32Array, right: Uint32Array): number => {
  const leftValues = new Set([...left].filter((value) => value !== 0xffff_ffff));
  const rightValues = new Set([...right].filter((value) => value !== 0xffff_ffff));
  if (leftValues.size === 0 || rightValues.size === 0) return 0;
  let intersection = 0;
  for (const value of leftValues) if (rightValues.has(value)) intersection += 1;
  return intersection / Math.min(leftValues.size, rightValues.size);
};

// Random-hyperplane SimHash compresses a local sentence embedding into 128
// non-reversible bits. Embeddings and source text are discarded after this step.
export const semanticSimHash = (embedding: ArrayLike<number>): Uint32Array => {
  const words = new Uint32Array(SEMANTIC_SIGNATURE_BITS / 32);
  for (let bit = 0; bit < SEMANTIC_SIGNATURE_BITS; bit += 1) {
    let projection = 0;
    for (let dimension = 0; dimension < embedding.length; dimension += 1) {
      const sign = (fnv1a(`${bit}:${dimension}`) & 1) === 0 ? -1 : 1;
      projection += (embedding[dimension] ?? 0) * sign;
    }
    if (projection >= 0) words[Math.floor(bit / 32)]! |= (1 << (bit % 32)) >>> 0;
  }
  return words;
};

const popcount = (value: number): number => {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export const semanticSimilarity = (left: Uint32Array, right: Uint32Array): number => {
  const words = Math.min(left.length, right.length);
  if (words === 0) return 0;
  let different = 0;
  for (let index = 0; index < words; index += 1) different += popcount((left[index] ?? 0) ^ (right[index] ?? 0));
  return 1 - different / (words * 32);
};

const hex = (bytes: Uint8Array): string => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export const exactSourceHash = (normalizedText: string) => Effect.tryPromise({
  try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedText.normalize("NFKC")) as BufferSource)
    .then((digest) => `${SOURCE_SIGNATURE_VERSION}:exact:${hex(new Uint8Array(digest))}`),
  catch: (cause) => new Error(`Could not calculate source exclusion hash: ${String(cause)}`),
});

export interface SourceExclusionSignatures {
  readonly version: typeof SOURCE_SIGNATURE_VERSION;
  readonly normalizationVersion: "adaptive_media_nfkc_v1";
  readonly semanticModelVersion: typeof SEMANTIC_MODEL_VERSION;
  readonly exact: ReadonlySet<string>;
  readonly lexical: readonly Uint32Array[];
  readonly semantic: readonly Uint32Array[];
}

// Exported only for deterministic evaluation fixtures. Production signatures
// must use keyedLexicalSketch with the device-local key.
export const evaluationLexicalSketch = (tokens: readonly NormalizedToken[]): Uint32Array => unkeyedLexicalMinHash(tokens);

export interface SourceSimilarityDecision {
  readonly displayable: boolean;
  readonly reason: "distinct" | "exact_copy" | "lexical_near_copy" | "semantic_near_copy" | "semantic_unavailable";
  readonly lexicalScore: number;
  readonly semanticScore: number | null;
}

export const evaluateSourceSimilarity = (
  exactHash: string,
  lexical: Uint32Array,
  semantic: Uint32Array | null,
  source: SourceExclusionSignatures,
): SourceSimilarityDecision => {
  if (source.exact.has(exactHash)) return { displayable: false, reason: "exact_copy", lexicalScore: 1, semanticScore: 1 };
  const lexicalScore = Math.max(0, ...source.lexical.map((signature) => lexicalSimilarity(lexical, signature)));
  if (lexicalScore >= LEXICAL_REJECTION_THRESHOLD) return { displayable: false, reason: "lexical_near_copy", lexicalScore, semanticScore: null };
  if (!semantic || source.semantic.length === 0) {
    return { displayable: false, reason: "semantic_unavailable", lexicalScore, semanticScore: null };
  }
  const semanticScore = Math.max(0, ...source.semantic.map((signature) => semanticSimilarity(semantic, signature)));
  if (semanticScore >= SEMANTIC_REJECTION_THRESHOLD) return { displayable: false, reason: "semantic_near_copy", lexicalScore, semanticScore };
  return { displayable: true, reason: "distinct", lexicalScore, semanticScore };
};
