import { describe, expect, it } from "vitest";
import { adaptiveLearningContentAgent } from "./adaptive-learning-content.agent.ts";
import { dailySessionGeneratorAgent } from "./daily-session-generator.agent.ts";
import { mediaAnalysisAgent } from "./media-analysis.agent.ts";
import { sentenceGeneratorAgent } from "./sentence-generator.agent.ts";

const agents = [
  ["daily session", dailySessionGeneratorAgent],
  ["sentence", sentenceGeneratorAgent],
  ["media analysis", mediaAnalysisAgent],
  ["adaptive learning", adaptiveLearningContentAgent],
] as const;

describe("OpenAI agent model selection", () => {
  it.each(agents)("uses GPT-5.6 Luna without reasoning for %s generation", async (_name, agent) => {
    const model = await agent.getModel();
    const options = await agent.getDefaultOptions();

    expect(model.modelId).toContain("gpt-5.6-luna");
    expect(options.providerOptions).toEqual({
      openai: { reasoningEffort: "none" },
    });
  });
});
