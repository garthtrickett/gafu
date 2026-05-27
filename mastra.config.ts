import { Mastra } from "@mastra/core/mastra";
import { sentenceGeneratorAgent } from "./src/lib/server/ai/agents/sentence-generator.agent";

export const mastra = new Mastra({
  agents: {
    sentenceGeneratorAgent,
  },
});
