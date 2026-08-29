import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  NORMALIZED_CUE_VERSION,
  TARGET_OFFSET_UNIT,
  type NormalizedToken,
} from "../../shared/adaptive-media.ts";
import type { DailySessionGenerationDraft } from "../../server/ai/schema.ts";
import {
  buildDailySessionFurigana,
  enrichDailySessionFurigana,
} from "./daily-session-furigana.ts";

const makeToken = (
  surface: string,
  start: number,
  reading = "",
): NormalizedToken => ({
  surface,
  lemma: surface,
  reading,
  partOfSpeech: [],
  conjugationType: null,
  conjugationForm: null,
  punctuation: /^[。、！？]$/u.test(surface),
  lineBreak: false,
  span: {
    start,
    end: start + surface.length,
    offsetUnit: TARGET_OFFSET_UNIT,
    normalizationVersion: NORMALIZED_CUE_VERSION,
  },
});

const draft: DailySessionGenerationDraft = {
  cards: [{
    grammar_point_id: "point-1",
    english_context: "A friend is waiting for your reaction.",
    japanese_sentence:
      "あなたがあげたプレゼントは、割に良かったかもしれない。",
    audio_url: null,
    explanation: "割に expresses an outcome relative to an expectation.",
  }],
};

describe("daily session furigana enrichment", () => {
  it("preserves every character when tokens leave prefix and punctuation gaps", () => {
    const sentence = draft.cards[0]!.japanese_sentence;
    const target = "割に良かったかもしれない";
    const targetStart = sentence.indexOf(target);

    const result = buildDailySessionFurigana(sentence, [
      makeToken(target, targetStart, "わりによかったかもしれない"),
    ]);

    expect(result.usedPlainTextFallback).toBe(false);
    expect(result.furigana).toEqual([
      { kanji: "あなたがあげたプレゼントは、" },
      { kanji: target, kana: "わりによかったかもしれない" },
      { kanji: "。" },
    ]);
    expect(result.furigana.map((segment) => segment.kanji).join(""))
      .toBe(sentence);
  });

  it("adds readings only to kanji tokens and retains whitespace gaps", () => {
    const result = buildDailySessionFurigana("学生 です。", [
      makeToken("学生", 0, "がくせい"),
      makeToken("です", 3, "です"),
      makeToken("。", 5),
    ]);

    expect(result.furigana).toEqual([
      { kanji: "学生", kana: "がくせい" },
      { kanji: " " },
      { kanji: "です" },
      { kanji: "。" },
    ]);
  });

  it("falls back to the complete plain sentence for malformed token spans", () => {
    const result = buildDailySessionFurigana("学生です。", [
      makeToken("違う", 0, "ちがう"),
    ]);

    expect(result).toEqual({
      japaneseSentence: "学生です。",
      furigana: [{ kanji: "学生です。" }],
      usedPlainTextFallback: true,
    });
  });

  it("keeps the generated session usable when the tokenizer is unavailable", async () => {
    const result = await Effect.runPromise(
      enrichDailySessionFurigana(
        draft,
        () => Effect.fail(new Error("dictionary unavailable")),
      ),
    );

    expect(result.cards[0]!.japanese_sentence).toBe(
      draft.cards[0]!.japanese_sentence,
    );
    expect(result.cards[0]!.furigana).toEqual([
      { kanji: draft.cards[0]!.japanese_sentence },
    ]);
  });
});
