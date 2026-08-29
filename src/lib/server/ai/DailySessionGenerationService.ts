import { Data, Effect } from "effect";
import {
  DailySessionGenerationRequestSchema,
  DailySessionProviderGenerationSchema,
  type DailySessionGenerationDraft,
  type DailySessionGenerationRequest,
} from "./schema.ts";

export interface DailySessionGenerationAgent {
  generate(
    prompt: string,
    options: {
      readonly structuredOutput: {
        readonly schema: typeof DailySessionProviderGenerationSchema;
      };
    },
  ): Promise<{ readonly object?: unknown }>;
}

export class DailySessionGenerationError extends Data.TaggedError(
  "DailySessionGenerationError",
)<{
  readonly code:
    | "invalid_request"
    | "not_configured"
    | "service_unavailable"
    | "invalid_result";
}> {}

const loadAgent = (): Effect.Effect<
  DailySessionGenerationAgent,
  DailySessionGenerationError
> =>
  Effect.gen(function* () {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      yield* Effect.logWarning(
        "[DailySessionGeneration] OPENAI_API_KEY is not configured.",
      );
      return yield* Effect.fail(
        new DailySessionGenerationError({ code: "not_configured" }),
      );
    }

    const agent = yield* Effect.tryPromise({
      try: async () => {
        const { mastra } = await import("../../../../mastra.config.ts");
        return mastra.getAgentById(
          "daily-session-generator",
        ) as DailySessionGenerationAgent | undefined;
      },
      catch: () =>
        new DailySessionGenerationError({
          code: "service_unavailable",
        }),
    });

    if (!agent) {
      return yield* Effect.fail(
        new DailySessionGenerationError({
          code: "service_unavailable",
        }),
      );
    }

    return agent;
  });

const validateGeneratedCards = (
  request: DailySessionGenerationRequest,
  generated: DailySessionGenerationDraft,
): Effect.Effect<DailySessionGenerationDraft, DailySessionGenerationError> =>
  Effect.gen(function* () {
    const expectedIds = request.queue.map(
      (item) => item.grammar_point_id,
    );
    const generatedIds = generated.cards.map(
      (card) => card.grammar_point_id,
    );
    const uniqueGeneratedIds = new Set(generatedIds);

    if (
      generatedIds.length !== expectedIds.length ||
      uniqueGeneratedIds.size !== generatedIds.length ||
      generatedIds.some(
        (generatedId, index) => generatedId !== expectedIds[index],
      )
    ) {
      yield* Effect.logWarning(
        "[DailySessionGeneration] Generated card IDs did not exactly match the requested queue.",
      );
      return yield* Effect.fail(
        new DailySessionGenerationError({ code: "invalid_result" }),
      );
    }

    return generated;
  });

export const generateDailySession = (
  request: DailySessionGenerationRequest,
  agentOverride?: DailySessionGenerationAgent,
): Effect.Effect<DailySessionGenerationDraft, DailySessionGenerationError> =>
  Effect.gen(function* () {
    const parsedRequest = DailySessionGenerationRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      yield* Effect.logWarning(
        "[DailySessionGeneration] Rejected an invalid session generation request.",
      );
      return yield* Effect.fail(
        new DailySessionGenerationError({ code: "invalid_request" }),
      );
    }

    const agent = agentOverride ?? (yield* loadAgent());
    yield* Effect.logInfo(
      `[DailySessionGeneration] Generating ${parsedRequest.data.queue.length} cards.`,
    );

    const response = yield* Effect.tryPromise({
      try: () =>
        agent.generate(JSON.stringify({
          contract: "daily_session_v1",
          mode: parsedRequest.data.mode,
          cardCount: parsedRequest.data.queue.length,
          queue: parsedRequest.data.queue,
          vocabularyPool: parsedRequest.data.vocabulary_pool,
          constraints: {
            oneCardPerQueueItem: true,
            preserveQueueOrder: true,
            preserveGrammarPointIds: true,
            revealAnswerInEnglishContext: false,
            englishContextPurpose: "surrounding situation immediately before the learner speaks",
            japaneseSentencePurpose: "the learner's next utterance within that situation",
            englishContextIsNotTranslationOfJapaneseSentence: true,
            englishContextMustUseSecondPerson: true,
            englishContextMustStopBeforeLearnerSpeaks: true,
            badEnglishContextExample: "She thinks this dress fits her well, given the special occasion.",
            goodEnglishContextExample: "A close friend is getting ready for a wedding and models a dress in front of a mirror. She turns to you and waits for your honest reaction.",
            contentVocabularyMustComeFromPool: true,
            audioUrlMustBeNull: true,
            furiganaIsDerivedByClient: true,
          },
        }), {
          structuredOutput: { schema: DailySessionProviderGenerationSchema },
        }),
      catch: () =>
        new DailySessionGenerationError({
          code: "service_unavailable",
        }),
    });

    const parsedResult = DailySessionProviderGenerationSchema.safeParse(
      response.object,
    );
    if (!parsedResult.success) {
      const issuePaths = parsedResult.error.issues
        .map((issue) => issue.path.join("."))
        .filter((path) => path.length > 0)
        .join(",");
      yield* Effect.logWarning(
        `[DailySessionGeneration] Provider returned an invalid structured result. issuePaths=${issuePaths || "root"}`,
      );
      return yield* Effect.fail(
        new DailySessionGenerationError({ code: "invalid_result" }),
      );
    }

    yield* Effect.logInfo(
      `[DailySessionGeneration] Provider attested to the pre-utterance context contract for ${parsedResult.data.cards.length} cards.`,
    );
    const draft: DailySessionGenerationDraft = {
      cards: parsedResult.data.cards.map((card) => ({
        grammar_point_id: card.grammar_point_id,
        english_context: card.english_context,
        japanese_sentence: card.japanese_sentence,
        audio_url: card.audio_url,
        explanation: card.explanation,
      })),
    };
    const validated = yield* validateGeneratedCards(
      parsedRequest.data,
      draft,
    );
    yield* Effect.logInfo(
      `[DailySessionGeneration] Generated and validated ${validated.cards.length} cards.`,
    );
    return validated;
  });
