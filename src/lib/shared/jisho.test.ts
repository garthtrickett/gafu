import { describe, it, expect } from "vitest";
import {
  extractJapaneseLookupTerm,
  jishoWebUrl,
  normalizeJishoResponse,
  MAX_LOOKUP_ENTRIES,
  MAX_LOOKUP_SENSES,
} from "./jisho.ts";

describe("extractJapaneseLookupTerm", () => {
  it("keeps a plain Japanese word", () => {
    expect(extractJapaneseLookupTerm("食べる")).toBe("食べる");
  });

  it("collapses the layout whitespace a ruby selection carries", () => {
    expect(extractJapaneseLookupTerm("\n        食べる\n      ")).toBe("食べる");
  });

  it("strips Japanese punctuation from the edges", () => {
    expect(extractJapaneseLookupTerm("「食べる」")).toBe("食べる");
    expect(extractJapaneseLookupTerm("食べる。")).toBe("食べる");
  });

  it("keeps iteration marks and long vowel marks that are part of words", () => {
    expect(extractJapaneseLookupTerm("人々")).toBe("人々");
    expect(extractJapaneseLookupTerm("コーヒー")).toBe("コーヒー");
  });

  it("rejects selections with no Japanese characters", () => {
    expect(extractJapaneseLookupTerm("hello there")).toBeNull();
    expect(extractJapaneseLookupTerm("。、！")).toBeNull();
    expect(extractJapaneseLookupTerm("   ")).toBeNull();
  });

  it("rejects a whole-sentence drag rather than searching it", () => {
    expect(extractJapaneseLookupTerm("今日は天気がいいので公園に散歩に行きましょうと思います")).toBeNull();
  });
});

describe("normalizeJishoResponse", () => {
  const payload = {
    meta: { status: 200 },
    data: [
      {
        slug: "食べる",
        is_common: true,
        tags: ["wanikani5"],
        jlpt: ["jlpt-n5"],
        japanese: [{ word: "食べる", reading: "たべる" }, { word: "喰べる", reading: "たべる" }],
        senses: [
          {
            english_definitions: ["to eat"],
            parts_of_speech: ["Ichidan verb", "Transitive verb"],
            tags: [],
            see_also: ["食う"],
          },
          {
            english_definitions: ["to live on", "to live off"],
            parts_of_speech: ["Ichidan verb"],
            tags: ["Colloquial"],
            see_also: [],
          },
        ],
      },
    ],
  };

  it("maps the community payload onto the wire contract", () => {
    const result = normalizeJishoResponse("食べる", payload);
    expect(result.term).toBe("食べる");
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0]!;
    expect(entry.slug).toBe("食べる");
    expect(entry.isCommon).toBe(true);
    expect(entry.jlpt).toEqual(["jlpt-n5"]);
    expect(entry.forms).toEqual([
      { word: "食べる", reading: "たべる" },
      { word: "喰べる", reading: "たべる" },
    ]);
    expect(entry.senses[0]).toEqual({
      englishDefinitions: ["to eat"],
      partsOfSpeech: ["Ichidan verb", "Transitive verb"],
      tags: [],
      seeAlso: ["食う"],
    });
    expect(entry.senses[1]!.englishDefinitions).toEqual(["to live on", "to live off"]);
  });

  it("returns no entries for an unreadable or empty payload", () => {
    expect(normalizeJishoResponse("食べる", null).entries).toEqual([]);
    expect(normalizeJishoResponse("食べる", { data: "nope" }).entries).toEqual([]);
    expect(normalizeJishoResponse("食べる", { data: [] }).entries).toEqual([]);
  });

  it("drops entries that carry no usable sense", () => {
    const result = normalizeJishoResponse("食べる", {
      data: [{ slug: "食べる", senses: [{ english_definitions: [] }] }, ...payload.data],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.slug).toBe("食べる");
  });

  it("bounds the entries and senses one lookup can render", () => {
    const sense = { english_definitions: ["meaning"], parts_of_speech: [] };
    const entry = { slug: "犬", senses: Array.from({ length: 12 }, () => sense) };
    const result = normalizeJishoResponse("犬", {
      data: Array.from({ length: 20 }, () => entry),
    });
    expect(result.entries).toHaveLength(MAX_LOOKUP_ENTRIES);
    expect(result.entries[0]!.senses).toHaveLength(MAX_LOOKUP_SENSES);
  });
});

describe("jishoWebUrl", () => {
  it("encodes the term for the public site", () => {
    expect(jishoWebUrl("食べる")).toBe("https://jisho.org/search/%E9%A3%9F%E3%81%B9%E3%82%8B");
  });
});
