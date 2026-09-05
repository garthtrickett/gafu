import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  JishoLookupError,
  clearJishoLookupCache,
  lookupJishoTerm,
  type JishoSearchRequest,
} from "./JishoDictionaryService.ts";

const payload = {
  data: [
    {
      slug: "犬",
      is_common: true,
      jlpt: ["jlpt-n5"],
      japanese: [{ word: "犬", reading: "いぬ" }],
      senses: [{ english_definitions: ["dog"], parts_of_speech: ["Noun"] }],
    },
  ],
};

const makeRequest = (calls: string[]): JishoSearchRequest => (keyword) =>
  Effect.sync(() => {
    calls.push(keyword);
    return payload;
  });

beforeEach(() => {
  clearJishoLookupCache();
});

describe("lookupJishoTerm", () => {
  it("normalizes a successful search", async () => {
    const result = await Effect.runPromise(lookupJishoTerm("犬", makeRequest([])));
    expect(result.term).toBe("犬");
    expect(result.entries[0]!.senses[0]!.englishDefinitions).toEqual(["dog"]);
  });

  it("normalizes the term before searching so punctuation does not reach jisho", async () => {
    const calls: string[] = [];
    await Effect.runPromise(lookupJishoTerm("「犬」", makeRequest(calls)));
    expect(calls).toEqual(["犬"]);
  });

  it("rejects a selection that is not a Japanese word", async () => {
    const calls: string[] = [];
    const error = await Effect.runPromise(Effect.flip(lookupJishoTerm("hello", makeRequest(calls))));
    expect(error).toBeInstanceOf(JishoLookupError);
    expect(error.reason).toBe("invalid_term");
    expect(calls).toEqual([]);
  });

  it("serves a repeated lookup from cache", async () => {
    const calls: string[] = [];
    const request = makeRequest(calls);
    await Effect.runPromise(lookupJishoTerm("犬", request));
    await Effect.runPromise(lookupJishoTerm("犬", request));
    expect(calls).toEqual(["犬"]);
  });

  it("searches again once the cached entry has expired", async () => {
    const calls: string[] = [];
    const request = makeRequest(calls);
    let now = 0;
    await Effect.runPromise(lookupJishoTerm("犬", request, () => now));
    now = 7 * 60 * 60 * 1000;
    await Effect.runPromise(lookupJishoTerm("犬", request, () => now));
    expect(calls).toEqual(["犬", "犬"]);
  });

  it("propagates an upstream failure without caching it", async () => {
    let attempts = 0;
    const failing: JishoSearchRequest = () => {
      attempts += 1;
      return Effect.fail(new JishoLookupError({ reason: "unavailable", message: "jisho.org returned HTTP 503." }));
    };

    const error = await Effect.runPromise(Effect.flip(lookupJishoTerm("犬", failing)));
    expect(error.reason).toBe("unavailable");

    await Effect.runPromise(Effect.flip(lookupJishoTerm("犬", failing)));
    expect(attempts).toBe(2);
  });
});
