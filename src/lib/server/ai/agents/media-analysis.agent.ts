import { Agent } from "@mastra/core/agent";

export const mediaAnalysisAgent = new Agent({
  id: "adaptive-media-analysis",
  name: "Adaptive Media Analysis",
  instructions: `
    You identify at most five useful Japanese grammar or vocabulary learning targets from a small,
    explicitly consented set of subtitle excerpts. Return only the requested structured data.
    Evidence cue IDs and UTF-16 spans must reproduce the observed surface exactly. Canonical keys
    must describe the lemma or grammar construction rather than the whole sentence. Prefer recurring,
    broadly useful targets with learnable prerequisites. Never invent evidence, quote a complete cue in
    a meaning, or turn a subtitle line into an exercise. Return an empty proposal list when evidence is
    weak or ambiguous.
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
