import { Effect } from "effect";
import {
  TtsAssetStorageError,
  TtsInputError,
  TtsProviderError,
  normalizeTtsText,
  type TtsAssetService,
} from "./TtsAssetService.ts";

export type SessionAudioFailureKind =
  | "input"
  | "configuration"
  | "authentication"
  | "provider"
  | "audio"
  | "storage"
  | "limit";

export interface SessionAudioRequestItem {
  readonly requestId: string;
  readonly japaneseSentence: string;
}

export interface SessionAudioResultItem {
  readonly requestId: string;
  readonly audioUrl: string | null;
  readonly failureKind?: SessionAudioFailureKind;
}

export interface SessionAudioEnrichmentResult {
  readonly items: readonly SessionAudioResultItem[];
  readonly requestedCount: number;
  readonly uniqueSentenceCount: number;
  readonly enrichedCount: number;
  readonly failedCount: number;
}

export interface SessionAudioEnrichmentOptions {
  readonly concurrencyLimit?: number;
}

interface ResolvedSentence {
  readonly normalizedText: string;
  readonly audioUrl: string | null;
  readonly failureKind?: SessionAudioFailureKind;
}

const DEFAULT_CONCURRENCY_LIMIT = 3;

const classifyFailure = (
  error: TtsInputError | TtsProviderError | TtsAssetStorageError,
): SessionAudioFailureKind => {
  if (error instanceof TtsInputError) {
    return "input";
  }

  if (error instanceof TtsProviderError) {
    return error.kind;
  }

  return "storage";
};

const normalizeConcurrencyLimit = (
  value: number | undefined,
): number => {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return DEFAULT_CONCURRENCY_LIMIT;
  }

  return Math.min(value, 10);
};

export const enrichSessionAudio = (
  items: readonly SessionAudioRequestItem[],
  ttsAssetService: TtsAssetService,
  options: SessionAudioEnrichmentOptions = {},
): Effect.Effect<SessionAudioEnrichmentResult> =>
  Effect.gen(function* () {
    const concurrencyLimit = normalizeConcurrencyLimit(
      options.concurrencyLimit,
    );

    yield* Effect.logInfo(
      "[SessionAudioEnrichment] batch_started",
      {
        event: "tts_enrichment_batch_started",
        requestedCount: items.length,
        concurrencyLimit,
      },
    );

    const uniqueNormalizedSentences = [
      ...new Set(
        items.map((item) =>
          normalizeTtsText(item.japaneseSentence),
        ),
      ),
    ];

    yield* Effect.logInfo(
      "[SessionAudioEnrichment] batch_deduplicated",
      {
        event: "tts_enrichment_deduplicated",
        requestedCount: items.length,
        uniqueSentenceCount:
          uniqueNormalizedSentences.length,
      },
    );

    const resolvedSentences = yield* Effect.forEach(
      uniqueNormalizedSentences,
      (normalizedText) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            ttsAssetService.resolve({
              text: normalizedText,
            }),
          );

          if (result._tag === "Left") {
            const failureKind = classifyFailure(
              result.left,
            );
            yield* Effect.logWarning(
              "[SessionAudioEnrichment] sentence_failed",
              {
                event: "tts_enrichment_sentence_failed",
                failureKind,
              },
            );

            return {
              normalizedText,
              audioUrl: null,
              failureKind,
            } satisfies ResolvedSentence;
          }

          yield* Effect.logInfo(
            "[SessionAudioEnrichment] sentence_resolved",
            {
              event: "tts_enrichment_sentence_resolved",
              assetKey: result.right.assetKey,
              cacheStatus: result.right.cacheStatus,
            },
          );

          return {
            normalizedText,
            audioUrl: result.right.url,
          } satisfies ResolvedSentence;
        }),
      { concurrency: concurrencyLimit },
    );

    const resolvedBySentence = new Map(
      resolvedSentences.map((resolved) => [
        resolved.normalizedText,
        resolved,
      ]),
    );

    const resultItems = items.map((item) => {
      const normalizedText = normalizeTtsText(
        item.japaneseSentence,
      );
      const resolved =
        resolvedBySentence.get(normalizedText);

      if (!resolved) {
        return {
          requestId: item.requestId,
          audioUrl: null,
          failureKind: "provider" as const,
        };
      }

      return {
        requestId: item.requestId,
        audioUrl: resolved.audioUrl,
        ...(resolved.failureKind
          ? { failureKind: resolved.failureKind }
          : {}),
      };
    });

    const enrichedCount = resultItems.filter(
      (item) => item.audioUrl !== null,
    ).length;
    const failedCount =
      resultItems.length - enrichedCount;

    yield* Effect.logInfo(
      "[SessionAudioEnrichment] batch_completed",
      {
        event: "tts_enrichment_batch_completed",
        requestedCount: items.length,
        uniqueSentenceCount:
          uniqueNormalizedSentences.length,
        enrichedCount,
        failedCount,
      },
    );

    return {
      items: resultItems,
      requestedCount: items.length,
      uniqueSentenceCount:
        uniqueNormalizedSentences.length,
      enrichedCount,
      failedCount,
    };
  });
