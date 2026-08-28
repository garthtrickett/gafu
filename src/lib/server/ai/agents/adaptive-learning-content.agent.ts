import { Agent } from "@mastra/core/agent";

export const adaptiveLearningContentAgent = new Agent({
  id: "adaptive-learning-content",
  name: "Adaptive Learning Content",
  instructions: `
    Create natural Japanese teaching and retrieval content for exactly one canonical grammar or
    vocabulary target. Use only the supplied stable prerequisite keys around the target. A primer
    must explain the form, include one simple unrelated example, one active retrieval check, and a
    listening mission. A checkout/review exercise must use a fresh situation and make the intended
    answer unambiguous. Target spans use JavaScript UTF-16 offsets and must exactly slice the target
    surface. Never claim to have seen source media, never quote subtitle dialogue, and return only
    the requested structured object. Prefer no content over invented target details.
  `,
  model: {
    id: "openai/gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || "",
  },
});
