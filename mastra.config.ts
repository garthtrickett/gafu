import { Mastra } from "@mastra/core/mastra";
import { sentenceGeneratorAgent } from "./src/lib/server/ai/agents/sentence-generator.agent";
import { mediaAnalysisAgent } from "./src/lib/server/ai/agents/media-analysis.agent.ts";

export const mastra = new Mastra({
  agents: {
    sentenceGeneratorAgent,
    mediaAnalysisAgent,
  },
});
