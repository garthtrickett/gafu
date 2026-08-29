import { Agent } from "@mastra/core/agent";

export const dailySessionGeneratorAgent = new Agent({
  id: "daily-session-generator",
  name: "Daily Japanese Study Session Generator",
  instructions: `
    Generate a complete Japanese study session from the supplied queue and vocabulary constraints.
    Produce exactly one card for every queue item, preserve each grammar_point_id exactly, preserve
    queue order, and never duplicate or omit an ID.
    Use only the supplied vocabulary pool for content words; ordinary particles, inflections, and
    copulas are allowed. Every English context must describe only the environment, internal state,
    motivation, and social relationship, stop before the learner's utterance, and reveal neither a
    translation nor the target grammar. Avoid formal pronouns unless ambiguity requires them.
    Japanese must be natural and conversational. In cram mode, prioritize practical reinforcement
    of active, unmastered targets. Return one authoritative japanese_sentence for each card; Gafu
    derives full-sentence furigana deterministically after validating your response. audio_url must
    always be null because audio is added by Gafu after validation. Return only the requested
    structured object.
  `,
  model: {
    id: "openai/gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || "",
  },
});
