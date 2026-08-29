import { Agent } from "@mastra/core/agent";

export const dailySessionGeneratorAgent = new Agent({
  id: "daily-session-generator",
  name: "Daily Japanese Study Session Generator",
  instructions: `
    Generate a complete Japanese study session from the supplied queue and vocabulary constraints.
    Produce exactly one card for every queue item, preserve each grammar_point_id exactly, preserve
    queue order, and never duplicate or omit an ID.
    Use only the supplied vocabulary pool for Japanese content words; ordinary particles,
    inflections, and copulas are allowed.

    The English context and Japanese sentence have different jobs. english_context is the scene
    immediately BEFORE the learner speaks: use second person and describe the setting, observable
    trigger, social relationship, and register needed to understand why the next utterance occurs.
    japanese_sentence is the utterance the learner says NEXT within that scene. It is never a
    translation of english_context.

    Do not put the meaning, conclusion, opinion, request, answer, or semantic paraphrase of the
    Japanese sentence in english_context. Stop before the learner speaks. BAD context for an
    utterance about a dress: "She thinks this dress fits her well, given the special occasion."
    This simply states the utterance in English. GOOD context: "A close friend is getting ready for
    a wedding and models a dress in front of a mirror. She turns to you and waits for your honest
    reaction." This supplies the surrounding situation without giving the answer.

    After drafting each pair, compare english_context with japanese_sentence. Revise the context if
    it states any meaning expressed by the Japanese. Set every context_quality field to true only
    after performing that check. Avoid formal pronouns unless ambiguity requires them.
    Japanese must be natural and conversational. In cram mode, prioritize practical reinforcement
    of active, unmastered targets. Return one authoritative japanese_sentence for each card; Gafu
    derives full-sentence furigana deterministically after validating your response. audio_url must
    always be null because audio is added by Gafu after validation. Return only the requested
    structured object.
  `,
  model: {
    id: "openai/gpt-5.6-luna",
    apiKey: process.env.OPENAI_API_KEY || "",
  },
  defaultOptions: {
    providerOptions: {
      openai: { reasoningEffort: "none" },
    },
  },
});
