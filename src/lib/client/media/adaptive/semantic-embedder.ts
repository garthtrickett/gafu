import { Effect } from "effect";
import { SEMANTIC_MODEL_VERSION } from "./source-signatures.ts";

export const SEMANTIC_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2" as const;

interface EmbeddingTensor {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

interface FeatureExtractor {
  (inputs: readonly string[], options: { readonly pooling: "mean"; readonly normalize: true }): Promise<EmbeddingTensor>;
}

let extractorPromise: Promise<FeatureExtractor> | null = null;

const loadExtractor = (): Promise<FeatureExtractor> => {
  extractorPromise ??= import("@xenova/transformers").then(async ({ env, pipeline }) => {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    return await pipeline("feature-extraction", SEMANTIC_MODEL_ID, { quantized: true }) as unknown as FeatureExtractor;
  });
  return extractorPromise;
};

export const splitEmbeddingRows = (tensor: EmbeddingTensor, expectedRows: number): readonly Float32Array[] => {
  if (expectedRows <= 0 || tensor.data.length === 0 || tensor.data.length % expectedRows !== 0) return [];
  const width = tensor.data.length / expectedRows;
  return Array.from({ length: expectedRows }, (_, row) => Float32Array.from(
    Array.from({ length: width }, (_, column) => tensor.data[row * width + column] ?? 0),
  ));
};

export const embedSentencesLocally = (texts: readonly string[]): Effect.Effect<readonly Float32Array[], Error> => {
  if (texts.length === 0) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const extractor = await loadExtractor();
      const tensor = await extractor(texts, { pooling: "mean", normalize: true });
      const rows = splitEmbeddingRows(tensor, texts.length);
      if (rows.length !== texts.length) throw new Error("Unexpected local embedding shape");
      return rows;
    },
    catch: () => new Error(`Local semantic validation model ${SEMANTIC_MODEL_VERSION} is unavailable.`),
  });
};
