import { describe, expect, it } from "vitest";
import type * as kuromoji from "kuromoji";
import { fallbackTokens, tokenizeJapaneseWith } from "./tokenizer.ts";

const fakeTokenizer = {
  tokenize: () => [{
    word_id: 1,
    word_type: "KNOWN",
    word_position: 1,
    surface_form: "食べました",
    pos: "動詞",
    pos_detail_1: "自立",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "一段",
    conjugated_form: "連用形",
    basic_form: "食べる",
    reading: "タベマシタ",
    pronunciation: "タベマシタ",
  }],
} as unknown as kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

describe("adaptive Japanese tokenizer", () => {
  it("preserves lemma, POS, conjugation, reading, and UTF-16 spans", () => {
    const tokens = tokenizeJapaneseWith("食べました", fakeTokenizer);
    expect(tokens[0]).toEqual(expect.objectContaining({
      surface: "食べました",
      lemma: "食べる",
      reading: "たべました",
      partOfSpeech: ["動詞", "自立"],
      conjugationType: "一段",
      conjugationForm: "連用形",
      span: expect.objectContaining({ start: 0, end: 5, offsetUnit: "utf16_code_units" }),
    }));
    expect("食べました".slice(tokens[0]!.span.start, tokens[0]!.span.end)).toBe(tokens[0]!.surface);
  });

  it("uses normalized UTF-16 offsets for surrogate pairs, NFKC, and line breaks", () => {
    const normalized = "Ａ😀\n語".normalize("NFKC");
    const tokens = fallbackTokens("Ａ😀\r\n語");
    for (const token of tokens) {
      expect(normalized.slice(token.span.start, token.span.end)).toBe(token.surface);
    }
    expect(tokens.find((token) => token.lineBreak)?.span).toMatchObject({ start: 3, end: 4 });
  });
});
