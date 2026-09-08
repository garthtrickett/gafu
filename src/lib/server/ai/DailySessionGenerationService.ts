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

type DailySessionDraftCard = DailySessionGenerationDraft["cards"][number];

const countIds = (ids: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/**
 * Describes how the generated IDs differ from the requested queue as a multiset,
 * or returns null when the provider returned exactly one card per queue item.
 * Order is deliberately excluded here because it is repairable.
 */
const describeIdMismatch = (
  expectedIds: readonly string[],
  generatedIds: readonly string[],
): string | null => {
  const expectedCounts = countIds(expectedIds);
  const generatedCounts = countIds(generatedIds);
  const problems: string[] = [];

  if (expectedIds.length !== generatedIds.length) {
    problems.push(
      `count expected=${expectedIds.length} generated=${generatedIds.length}`,
    );
  }
  for (const [id, expected] of expectedCounts) {
    const generated = generatedCounts.get(id) ?? 0;
    if (generated < expected) {
      problems.push(`missing=${id} expected=${expected} generated=${generated}`);
    }
  }
  for (const [id, generated] of generatedCounts) {
    const expected = expectedCounts.get(id) ?? 0;
    if (expected === 0) {
      problems.push(`unrequested=${id}`);
    } else if (generated > expected) {
      problems.push(
        `duplicated=${id} expected=${expected} generated=${generated}`,
      );
    }
  }

  return problems.length > 0 ? problems.join("; ") : null;
};

const restoreQueueOrder = (
  expectedIds: readonly string[],
  cards: readonly DailySessionDraftCard[],
): DailySessionDraftCard[] => {
  const cardsById = new Map<string, DailySessionDraftCard[]>();
  for (const card of cards) {
    const bucket = cardsById.get(card.grammar_point_id);
    if (bucket) {
      bucket.push(card);
    } else {
      cardsById.set(card.grammar_point_id, [card]);
    }
  }
  // Safe because the caller has already proven the ID multisets match exactly.
  return expectedIds.map((id) => cardsById.get(id)!.shift()!);
};

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

    const mismatch = describeIdMismatch(expectedIds, generatedIds);
    if (mismatch) {
      yield* Effect.logWarning(
        `[DailySessionGeneration] Generated card IDs did not match the requested queue: ${mismatch}`,
      );
      return yield* Effect.fail(
        new DailySessionGenerationError({ code: "invalid_result" }),
      );
    }

    // The provider was asked to preserve queue order, but order carries no
    // meaning downstream: cards are matched back to progress by ID on import.
    // Repair the order instead of discarding an otherwise complete session.
    if (generatedIds.some((id, index) => id !== expectedIds[index])) {
      yield* Effect.logInfo(
        `[DailySessionGeneration] Provider returned the requested ${expectedIds.length} cards out of queue order; restoring queue order.`,
      );
      return { cards: restoreQueueOrder(expectedIds, generated.cards) };
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
