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
    surface. For checkout/review, explicitly classify the situation, surrounding vocabulary,
    conjugation, politeness, register, speaker intention, polarity, and question form. Use the
    supplied recent variation history to change at least two material dimensions, not merely a noun.
    Echo the exact target canonical key and set every quality check true only after checking the
    intended sense/function, answer ambiguity, natural Japanese, and requested register; if any
    check fails, revise the exercise before returning it.
    Never claim to have seen source media, never quote subtitle dialogue, and return only the
    requested structured object. Prefer no content over invented target details.
  `,
  model: {
    id: "openai/gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || "",
  },
});
