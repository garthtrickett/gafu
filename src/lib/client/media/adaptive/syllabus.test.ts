import { describe, expect, it } from "vitest";
import type { NormalizedCue } from "../../../shared/adaptive-media.ts";
import { TARGET_OFFSET_UNIT, NORMALIZED_CUE_VERSION } from "../../../shared/adaptive-media.ts";
import {
  buildEpisodeSyllabus,
  buildGrammarEvidenceMatchers,
  canonicalVocabularyKey,
  knownCanonicalKeysForLearner,
} from "./syllabus.ts";

const token = (surface: string, lemma: string, start: number, pos = "動詞") => ({
  surface,
  lemma,
  reading: "たべました",
  partOfSpeech: [pos],
  conjugationType: "一段",
  conjugationForm: "連用形",
  punctuation: false,
  lineBreak: false,
  span: { start, end: start + surface.length, offsetUnit: TARGET_OFFSET_UNIT, normalizationVersion: NORMALIZED_CUE_VERSION },
});

const cue = (id: string, text: string, tokens: NormalizedCue["tokens"]): NormalizedCue => ({
  id, subtitleTrackFingerprint: "track", sourceCueOrdinal: 0,
  sourceStartSeconds: 1, sourceEndSeconds: 2, normalizedText: text,
  normalizationVersion: NORMALIZED_CUE_VERSION, tokens,
});

describe("episode syllabus preprocessing", () => {
  it("canonicalizes conjugated surface forms by lemma and matches existing vocabulary", () => {
    const observed = token("食べました", "食べる", 0);
    const key = canonicalVocabularyKey(observed);
    const syllabus = buildEpisodeSyllabus(
      [cue("cue-1", "食べました", [observed])],
      [{ id: "kp-eat", kind: "vocabulary", canonicalKey: key, meaning: "to eat", difficulty: 4 }],
      [],
    );
    expect(syllabus.items).toEqual([expect.objectContaining({ knowledgePointId: "kp-eat", label: "食べる", occurrenceCount: 1 })]);
  });

  it("excludes stable/known points and never recommends more than three", () => {
    const cues = ["猫", "犬", "鳥", "魚"].map((surface, index) => cue(`cue-${index}`, surface, [token(surface, surface, 0, "名詞")]));
    const catalog = cues.map((entry, index) => ({
      id: `kp-${index}`, kind: "vocabulary" as const,
      canonicalKey: canonicalVocabularyKey(entry.tokens[0]!), meaning: `meaning-${index}`, difficulty: 3,
    }));
    const syllabus = buildEpisodeSyllabus(cues, catalog, [{ knowledgePointId: "kp-0", learningState: "known", participationStatus: "active" }]);
    expect(syllabus.items).toHaveLength(3);
    expect(syllabus.items.map((item) => item.knowledgePointId)).not.toContain("kp-0");
  });

  it("matches token-aligned grammar from the bank and does not duplicate it as vocabulary", () => {
    const observed = token("よ", "よ", 0, "助詞");
    const catalog = [{
      id: "grammar-yo",
      kind: "grammar" as const,
      canonicalKey: "grammar:よ",
      meaning: "sentence-ending emphasis",
      difficulty: 1,
    }];
    const syllabus = buildEpisodeSyllabus(
      [cue("cue-yo", "よ", [observed])],
      catalog,
      [],
      buildGrammarEvidenceMatchers(catalog),
    );

    expect(syllabus.items).toEqual([expect.objectContaining({
      knowledgePointId: "grammar-yo",
      kind: "grammar",
      label: "よ",
      occurrenceCount: 1,
    })]);
  });

  it("prefers the exact bank point over annotated aliases and ignores matches inside tokens", () => {
    const catalog = [{
      id: "grammar-no",
      kind: "grammar" as const,
      canonicalKey: "grammar:の",
      meaning: "particle",
      difficulty: 1,
    }, {
      id: "grammar-nominalizer",
      kind: "grammar" as const,
      canonicalKey: "grammar:の (nominalizer)",
      meaning: "nominalizer",
      difficulty: 2,
    }];
    const matchers = buildGrammarEvidenceMatchers(catalog);
    const insideWord = token("もの", "もの", 0, "名詞");

    expect(buildEpisodeSyllabus([cue("cue-word", "もの", [insideWord])], catalog, [], matchers).items)
      .toEqual([expect.objectContaining({ kind: "vocabulary", label: "もの" })]);
    expect(matchers.filter((matcher) => matcher.canonicalKey === "grammar:の")).toHaveLength(1);
    expect(matchers.some((matcher) => matcher.canonicalKey === "grammar:の (nominalizer)")).toBe(false);
  });

  it("filters grammar points already known or stable in the learner profile", () => {
    const observed = token("よ", "よ", 0, "助詞");
    const catalog = [{
      id: "grammar-yo",
      kind: "grammar" as const,
      canonicalKey: "grammar:よ",
      meaning: "sentence-ending emphasis",
      difficulty: 1,
    }];
    const learner = [{ knowledgePointId: "grammar-yo", learningState: "known" as const, participationStatus: "active" as const }];
    const knownKeys = knownCanonicalKeysForLearner(catalog, learner);
    const syllabus = buildEpisodeSyllabus(
      [cue("cue-yo", "よ", [observed])],
      catalog,
      learner,
      buildGrammarEvidenceMatchers(catalog),
    );

    expect(knownKeys).toEqual(new Set(["grammar:よ"]));
    expect(syllabus.items).toEqual([]);
    expect(syllabus.rejectedCandidateIds).toContain("candidate:grammar:よ");
  });

  it("prefers a longer canonical grammar match over a nested particle", () => {
    const tokens = [
      token("か", "か", 0, "助詞"),
      token("も", "も", 1, "助詞"),
      token("しれ", "しれる", 2),
      token("ない", "ない", 4, "助動詞"),
    ];
    const catalog = [{
      id: "grammar-ka",
      kind: "grammar" as const,
      canonicalKey: "grammar:か",
      meaning: "question particle",
      difficulty: 1,
    }, {
      id: "grammar-maybe",
      kind: "grammar" as const,
      canonicalKey: "grammar:かもしれない",
      meaning: "might",
      difficulty: 3,
    }];
    const syllabus = buildEpisodeSyllabus(
      [cue("cue-maybe", "かもしれない", tokens)],
      catalog,
      [],
      buildGrammarEvidenceMatchers(catalog),
    );

    expect(syllabus.items).toEqual([expect.objectContaining({
      knowledgePointId: "grammar-maybe",
      kind: "grammar",
      occurrenceCount: 1,
    })]);
  });

  it("rejects evidence whose UTF-16 span does not reproduce the observed surface", () => {
    const malformed = { ...token("食べました", "食べる", 2), span: { ...token("食べました", "食べる", 2).span, end: 7 } };
    const syllabus = buildEpisodeSyllabus([cue("cue-bad", "食べました", [malformed])], [], []);
    expect(syllabus.items).toEqual([]);
    expect(syllabus.rejectedCandidateIds).toHaveLength(1);
  });

  it("aggregates heavily repeated subtitle tokens without copying prior evidence", () => {
    const cues = Array.from({ length: 2_000 }, (_, index) =>
      cue(`cue-${index}`, "猫", [token("猫", "猫", 0, "名詞")]));

    const syllabus = buildEpisodeSyllabus(cues, [], []);

    expect(syllabus.items).toEqual([
      expect.objectContaining({ label: "猫", occurrenceCount: 2_000 }),
    ]);
  });
});
