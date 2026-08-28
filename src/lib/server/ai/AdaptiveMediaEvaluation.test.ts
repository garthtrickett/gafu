import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSrt } from "../../client/media/adaptive/subtitles.ts";
import { generatedExerciseSimilarity } from "../ExerciseBankService.ts";

interface EvaluationCorpus {
  readonly version: string;
  readonly copyright: string;
  readonly recommendationCases: readonly {
    readonly id: string;
    readonly learner: { readonly remainingCapacity: number };
    readonly cue: string;
    readonly expectedCanonicalKey?: string;
    readonly expectedDisposition: string;
  }[];
  readonly sourceSimilarityCases: readonly {
    readonly id: string;
    readonly source: string;
    readonly candidate: string;
    readonly expected: string;
  }[];
  readonly humanReviewSamples: readonly {
    readonly id: string;
    readonly register: "casual" | "polite";
    readonly targetCanonicalKey: string;
    readonly context: string;
    readonly sentence: string;
    readonly reviewStatus: "pending_human" | "approved" | "rejected";
  }[];
}

const loadCorpus = async (): Promise<EvaluationCorpus> => JSON.parse(await readFile(
  resolve(process.cwd(), "src/test/fixtures/adaptive-media/evaluation-cases.json"), "utf8",
)) as EvaluationCorpus;

describe("versioned adaptive-media release evaluation", () => {
  it("covers capacity, ambiguity, contractions, inflection, names, malformed input, and stable canonical identities", async () => {
    const corpus = await loadCorpus();
    expect(corpus.version).toBe("adaptive_media_eval_v1");
    expect(corpus.copyright).toBe("synthetic");
    expect(corpus.recommendationCases.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "early-contracted-grammar", "zero-capacity", "polite-inflected-vocabulary", "ambiguous-name", "malformed-empty",
    ]));
    for (const entry of corpus.recommendationCases) {
      expect(entry.learner.remainingCapacity).toBeGreaterThanOrEqual(0);
      if (entry.expectedCanonicalKey) expect(entry.expectedCanonicalKey).toMatch(/^(grammar|vocabulary):/);
      if (entry.learner.remainingCapacity === 0) expect(entry.expectedDisposition).not.toBe("recommend");
      if (entry.cue.length === 0) expect(entry.expectedDisposition).toBe("none");
    }
  });

  it("keeps exact, lexical, semantic, and cosmetic source-reuse cases release blocking", async () => {
    const corpus = await loadCorpus();
    expect(corpus.sourceSimilarityCases.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "exact", "lexical-near-copy", "varied-context", "cosmetic-substitution",
    ]));
    const exact = corpus.sourceSimilarityCases.find((entry) => entry.id === "exact")!;
    expect(exact.source.normalize("NFKC")).toBe(exact.candidate.normalize("NFKC"));
    const cosmetic = corpus.sourceSimilarityCases.find((entry) => entry.id === "cosmetic-substitution")!;
    expect(generatedExerciseSimilarity(cosmetic.source, cosmetic.candidate)).toBeGreaterThan(0.65);
    const varied = corpus.sourceSimilarityCases.find((entry) => entry.id === "varied-context")!;
    expect(generatedExerciseSimilarity(varied.source, varied.candidate)).toBeLessThan(0.65);
  });

  it("has explicit casual and polite human-Japanese review rows without pretending AI is human approval", async () => {
    const corpus = await loadCorpus();
    expect(new Set(corpus.humanReviewSamples.map((entry) => entry.register))).toEqual(new Set(["casual", "polite"]));
    expect(corpus.humanReviewSamples.every((entry) => entry.reviewStatus === "pending_human")).toBe(true);
  });

  it("parses a representative episode-length synthetic track within the release budget", () => {
    const records = Array.from({ length: 1_200 }, (_, index) => {
      const start = index * 2;
      const end = start + 1;
      const timestamp = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remaining = seconds % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")},000`;
      };
      return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n合成字幕${index}です。`;
    }).join("\n\n");
    const started = performance.now();
    const cues = parseSrt(records, "episode-length-release-fixture");
    const elapsed = performance.now() - started;
    expect(cues).toHaveLength(1_200);
    expect(elapsed).toBeLessThan(5_000);
    expect(cues.every((cue) => cue.normalizedText.length < 40)).toBe(true);
  });
});
