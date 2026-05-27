import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { generateJapaneseSentence, AiServiceError } from "./ai.service";
import { mastra } from "../../../mastra.config";

vi.mock("../../../mastra.config", () => {
  const mockAgent = {
    generate: vi.fn()
  };
  return {
    mastra: {
      getAgentById: vi.fn(() => mockAgent)
    }
  };
});

describe("AI Sentence Generation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a structured Japanese sentence successfully", async () => {
    const mockOutput = {
      front: "At a restaurant, ordering water.",
      back: "お水、お願いします。",
      furigana: [
        { kanji: "お" },
        { kanji: "水", kana: "みず" },
        { kanji: "、お願いします。" }
      ]
    };

    const mockAgent = mastra.getAgentById("japanese-sentence-generator");
    vi.mocked(mockAgent!.generate).mockResolvedValue({
      object: mockOutput,
      text: "",
      toolCalls: [],
      steps: []
    } as any);

    const program = generateJapaneseSentence("Order water at a restaurant");
    const result = await Effect.runPromise(program);

    expect(result).toEqual(mockOutput);
    expect(mockAgent!.generate).toHaveBeenCalledWith(
      "Order water at a restaurant",
      expect.objectContaining({
        structuredOutput: expect.any(Object)
      })
    );
  });

  it("should fail with AiServiceError when agent generation fails", async () => {
    const mockAgent = mastra.getAgentById("japanese-sentence-generator");
    vi.mocked(mockAgent!.generate).mockRejectedValue(new Error("LLM Timeout"));

    const program = generateJapaneseSentence("Order water");
    const result = await Effect.runPromise(Effect.either(program));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(AiServiceError);
      expect(result.left.message).toContain("Failed to generate structured sentence via Mastra AI");
    }
  });

  it("should fail with AiServiceError when the agent is not found", async () => {
    vi.mocked(mastra.getAgentById).mockReturnValue(undefined as any);

    const program = generateJapaneseSentence("Order water");
    const result = await Effect.runPromise(Effect.either(program));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(AiServiceError);
      expect(result.left.message).toContain("Mastra Agent 'japanese-sentence-generator' not registered.");
    }
  });
});
