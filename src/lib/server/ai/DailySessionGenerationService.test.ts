import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  DailySessionGenerationError,
  generateDailySession,
  type DailySessionGenerationAgent,
} from "./DailySessionGenerationService.ts";
import type { DailySessionGenerationRequest } from "./schema.ts";

const request: DailySessionGenerationRequest = {
  mode: "standard",
  queue: [
    {
      grammar_point_id: "point-1",
      formal_name: "です",
      repetitions: 1,
      ease_factor: 2.5,
    },
    {
      grammar_point_id: "point-2",
      formal_name: "から",
      repetitions: 0,
      ease_factor: 2.5,
    },
  ],
  vocabulary_pool: ["学生", "学校"],
};

const validDraftResult = {
  cards: [
    {
      grammar_point_id: "point-1",
      english_context: "A classmate waits for your introduction.",
      japanese_sentence: "学生です。",
      audio_url: null,
      explanation: "です marks a polite assertion.",
    },
    {
      grammar_point_id: "point-2",
      english_context: "You have just arrived from school.",
      japanese_sentence: "学校から。",
      audio_url: null,
      explanation: "から marks the origin.",
    },
  ],
};

const contextQuality = {
  describes_situation_before_utterance: true,
  stops_before_learner_speaks: true,
  omits_utterance_meaning: true,
  is_not_translation_or_paraphrase: true,
} as const;

const validProviderResult = {
  cards: validDraftResult.cards.map((card) => ({
    ...card,
    context_quality: contextQuality,
  })),
};

const makeAgent = (object: unknown): DailySessionGenerationAgent => ({
  generate: vi.fn().mockResolvedValue({ object }),
});

const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

describe("DailySessionGenerationService", () => {
  it("generates one validated card per requested queue item", async () => {
    const agent = makeAgent(validProviderResult);

    const result = await Effect.runPromise(
      generateDailySession(request, agent),
    );

    expect(result).toEqual(validDraftResult);
    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('"contract":"daily_session_v1"'),
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          schema: expect.any(Object),
        }),
      }),
    );
    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('"furiganaIsDerivedByClient":true'),
      expect.any(Object),
    );
    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('"englishContextIsNotTranslationOfJapaneseSentence":true'),
      expect.any(Object),
    );
    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining("She thinks this dress fits her well, given the special occasion."),
      expect.any(Object),
    );
    expect(result.cards[0]).not.toHaveProperty("context_quality");
  });

  it("rejects an empty queue before calling the provider", async () => {
    const agent = makeAgent(validProviderResult);
    const invalidRequest = {
      ...request,
      queue: [],
    } as DailySessionGenerationRequest;

    const result = await Effect.runPromise(
      Effect.either(generateDailySession(invalidRequest, agent)),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: { code: "invalid_request" },
    });
    expect(agent.generate).not.toHaveBeenCalled();
  });

  it("rejects missing, duplicate, or reordered queue IDs", async () => {
    const invalidResult = {
      cards: [validProviderResult.cards[1], validProviderResult.cards[1]],
    };

    const result = await Effect.runPromise(
      Effect.either(generateDailySession(request, makeAgent(invalidResult))),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: { code: "invalid_result" },
    });
  });

  it("rejects cards that do not attest to the pre-utterance context contract", async () => {
    const result = await Effect.runPromise(
      Effect.either(generateDailySession(request, makeAgent(validDraftResult))),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: { code: "invalid_result" },
    });
  });

  it("discards provider furigana so a partial duplicate cannot invalidate the authoritative sentence", async () => {
    const providerResult = {
      cards: [
        {
          ...validProviderResult.cards[0],
          japanese_sentence:
            "あなたがあげたプレゼントは、割に良かったかもしれない。",
          furigana: [{ kanji: "割に良かったかもしれない" }],
        },
        validProviderResult.cards[1],
      ],
    };

    const result = await Effect.runPromise(
      generateDailySession(request, makeAgent(providerResult)),
    );

    expect(result.cards[0]!.japanese_sentence).toBe(
      providerResult.cards[0]!.japanese_sentence,
    );
    expect(result.cards[0]).not.toHaveProperty("furigana");
  });

  it("reports a missing server API key without loading the provider", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await Effect.runPromise(
      Effect.either(generateDailySession(request)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(DailySessionGenerationError);
      expect(result.left.code).toBe("not_configured");
    }
  });
});
