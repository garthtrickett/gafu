import { Mastra } from "@mastra/core/mastra";
import { sentenceGeneratorAgent } from "./src/lib/server/ai/agents/sentence-generator.agent";
import { mediaAnalysisAgent } from "./src/lib/server/ai/agents/media-analysis.agent.ts";
import { adaptiveLearningContentAgent } from "./src/lib/server/ai/agents/adaptive-learning-content.agent.ts";
import { dailySessionGeneratorAgent } from "./src/lib/server/ai/agents/daily-session-generator.agent.ts";

export const mastra = new Mastra({
  agents: {
    sentenceGeneratorAgent,
    mediaAnalysisAgent,
    adaptiveLearningContentAgent,
    dailySessionGeneratorAgent,
  },
});
