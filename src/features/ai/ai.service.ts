import { Effect, Data } from "effect";
import { mastra } from "../../../mastra.config";
import { SentenceGenerationSchema } from "../../lib/server/ai/schema";

export class AiServiceError extends Data.TaggedError("AiServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const generateJapaneseSentence = (prompt: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("[AiService] Requesting structured sentence generation from Mastra.");

    const agent = yield* Effect.sync(() => mastra.getAgentById("japanese-sentence-generator"));
    if (!agent) {
      yield* Effect.logError("[AiService] Mastra failed to retrieve 'japanese-sentence-generator'. Verify registration in mastra.config.ts.");
      return yield* Effect.fail(new AiServiceError({ message: "Mastra Agent 'japanese-sentence-generator' not registered." }));
    }

        const response = yield* Effect.tryPromise({
      try: () =>
        agent.generate(prompt, {
          structuredOutput: {
            schema: SentenceGenerationSchema,
          },
        }),
      catch: () => {
        return new AiServiceError({
          message: "Failed to generate structured sentence via Mastra AI.",
        });
      },
    });

    yield* Effect.logInfo("[AiService] Successfully received structured output from Mastra.");
    
    const result = response.object;
    return result;
  });
