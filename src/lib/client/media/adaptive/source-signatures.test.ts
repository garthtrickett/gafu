import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fallbackTokens } from "./tokenizer.ts";
import {
  evaluateSourceSimilarity,
  exactSourceHash,
  keyedLexicalSketch,
  semanticSimHash,
  semanticSimilarity,
} from "./source-signatures.ts";

describe("non-displayable source exclusion signatures", () => {
  it("rejects exact source dialogue without retaining its text", async () => {
    const sourceText = "合成された架空の台詞です";
    const sourceHash = await Effect.runPromise(exactSourceHash(sourceText));
    const key = new Uint8Array(32).fill(7);
    const decision = evaluateSourceSimilarity(
      sourceHash,
      await Effect.runPromise(keyedLexicalSketch(fallbackTokens(sourceText), key)),
      semanticSimHash([0.1, 0.5, -0.2]),
      { version: "source_signature_v1", normalizationVersion: "adaptive_media_nfkc_v1", semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2", exact: new Set([sourceHash]), lexical: [], semantic: [] },
    );
    expect(decision.reason).toBe("exact_copy");
    expect(JSON.stringify({ hash: sourceHash })).not.toContain(sourceText);
  });

  it("rejects lexical near-copies and semantically close embedding signatures", async () => {
    const sourceTokens = fallbackTokens("猫 が 静か に 歩く");
    const key = new Uint8Array(32).fill(9);
    const sourceSketch = await Effect.runPromise(keyedLexicalSketch(sourceTokens, key));
    const exact = await Effect.runPromise(exactSourceHash("different"));
    expect(evaluateSourceSimilarity(
      exact,
      sourceSketch,
      semanticSimHash([1, 0, 0, 0]),
      { version: "source_signature_v1", normalizationVersion: "adaptive_media_nfkc_v1", semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2", exact: new Set(), lexical: [sourceSketch], semantic: [] },
    ).reason).toBe("lexical_near_copy");
    expect(semanticSimilarity(semanticSimHash([1, 0.2, -0.1]), semanticSimHash([1, 0.2, -0.1]))).toBe(1);
  });

  it("fails closed when semantic comparison is unavailable", async () => {
    const hash = await Effect.runPromise(exactSourceHash("new sentence"));
    const key = new Uint8Array(32).fill(11);
    const decision = evaluateSourceSimilarity(hash, await Effect.runPromise(keyedLexicalSketch(fallbackTokens("new sentence"), key)), null, {
      version: "source_signature_v1", normalizationVersion: "adaptive_media_nfkc_v1", semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2",
      exact: new Set(),
      lexical: [await Effect.runPromise(keyedLexicalSketch(fallbackTokens("episode source"), key))],
      semantic: [],
    });
    expect(decision).toMatchObject({ displayable: false, reason: "semantic_unavailable" });
  });

  it("fails closed when source semantic signatures have not been built", async () => {
    const key = new Uint8Array(32).fill(13);
    const lexical = await Effect.runPromise(keyedLexicalSketch(fallbackTokens("unrelated candidate"), key));
    const sourceLexical = await Effect.runPromise(keyedLexicalSketch(fallbackTokens("private source line"), key));
    const decision = evaluateSourceSimilarity("candidate-hash", lexical, semanticSimHash([1, 0, 0]), {
      version: "source_signature_v1",
      normalizationVersion: "adaptive_media_nfkc_v1",
      semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2",
      exact: new Set(["source-hash"]),
      lexical: [sourceLexical],
      semantic: [],
    });
    expect(decision).toMatchObject({ displayable: false, reason: "semantic_unavailable" });
  });
});
