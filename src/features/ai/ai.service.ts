import { Effect, Data } from "effect";
import { mastra } from "../../../mastra.config";
import type { SentenceGeneration } from "../../lib/server/ai/schema";
import { SentenceGenerationSchema } from "../../lib/server/ai/schema";

export class AiServiceError extends Data.TaggedError("AiServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const generateJapaneseSentence = (prompt: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[AiService] Requesting structured sentence generation from Mastra for prompt: "${prompt}"`);

    const agent = yield* Effect.sync(() => mastra.getAgentById("sentenceGeneratorAgent"));
    if (!agent) {
      yield* Effect.logError("[AiService] Mastra failed to retrieve 'sentenceGeneratorAgent'. Verify registration in mastra.config.ts.");
      return yield* Effect.fail(new AiServiceError({ message: "Mastra Agent 'sentenceGeneratorAgent' not registered." }));
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        agent.generate(prompt, {
          structuredOutput: SentenceGenerationSchema,
        }),
      catch: (error) => {
        return new AiServiceError({
          message: "Failed to generate structured sentence via Mastra AI.",
          cause: error,
        });
      },
    });

    yield* Effect.logInfo("[AiService] Successfully received structured output from Mastra.");
    
    const result = response.object as SentenceGeneration;
    yield* Effect.logInfo(`[AiService] Parsed result details - Front: "${result.front}", Back: "${result.back}"`);

    return result;
  });
