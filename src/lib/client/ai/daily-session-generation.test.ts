import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { requestDailySessionGeneration } from "./daily-session-generation.ts";
import type { DailySessionGenerationRequest } from "../../server/ai/schema.ts";

const request: DailySessionGenerationRequest = {
  mode: "standard",
  queue: [{
    grammar_point_id: "point-1",
    formal_name: "です",
    repetitions: 0,
    ease_factor: 2.5,
  }],
  vocabulary_pool: ["学生"],
};

const generated = {
  cards: [{
    grammar_point_id: "point-1",
    english_context: "A classmate waits for your introduction.",
    japanese_sentence: "学生です。",
    furigana: [
      { kanji: "学生", kana: "がくせい" },
      { kanji: "です。" },
    ],
    audio_url: null,
    explanation: "です marks a polite assertion.",
  }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestDailySessionGeneration", () => {
  it("sends the bounded payload and bearer token to the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: generated }), {
        status: 200,
      }),
    );

    const result = await Effect.runPromise(
      requestDailySessionGeneration("jwt-token", request),
    );

    expect(result).toEqual(generated);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/generate-session",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jwt-token",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("does not call the server without an authenticated token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await Effect.runPromise(
      Effect.either(requestDailySessionGeneration("", request)),
    );

    expect(result).toMatchObject({ _tag: "Left" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a missing server API key as an actionable error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        error: "AI generation is not configured. Set OPENAI_API_KEY on the server.",
      }), { status: 503 }),
    );

    const result = await Effect.runPromise(
      Effect.either(requestDailySessionGeneration("jwt-token", request)),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        message: "AI generation is not configured. Set OPENAI_API_KEY on the server.",
      },
    });
  });

  it("rejects a successful response without generated cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
      }),
    );

    const result = await Effect.runPromise(
      Effect.either(requestDailySessionGeneration("jwt-token", request)),
    );

    expect(result).toMatchObject({ _tag: "Left" });
  });
});
