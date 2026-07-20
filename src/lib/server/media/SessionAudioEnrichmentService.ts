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
  | "storage";

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
  readonly enrichedCount: number;
  readonly failedCount: number;
}

interface ResolvedSentence {
  readonly normalizedText: string;
  readonly audioUrl: string | null;
  readonly failureKind?: SessionAudioFailureKind;
}

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

export const enrichSessionAudio = (
  items: readonly SessionAudioRequestItem[],
  ttsAssetService: TtsAssetService,
): Effect.Effect<SessionAudioEnrichmentResult> =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `[SessionAudioEnrichment] Received ${items.length} audio enrichment requests.`,
    );

    const uniqueNormalizedSentences = [
      ...new Set(
        items.map((item) =>
          normalizeTtsText(item.japaneseSentence),
        ),
      ),
    ];

    yield* Effect.logInfo(
      `[SessionAudioEnrichment] Collapsed ${items.length} requests into ${uniqueNormalizedSentences.length} unique deterministic sentences.`,
    );

    const resolvedSentences = yield* Effect.forEach(
      uniqueNormalizedSentences,
      (normalizedText) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            ttsAssetService.resolve({ text: normalizedText }),
          );

          if (result._tag === "Left") {
            const failureKind = classifyFailure(result.left);
            yield* Effect.logWarning(
              `[SessionAudioEnrichment] Failed to resolve one unique sentence. failureKind=${failureKind}`,
            );

            return {
              normalizedText,
              audioUrl: null,
              failureKind,
            } satisfies ResolvedSentence;
          }

          yield* Effect.logInfo(
            `[SessionAudioEnrichment] Resolved ${result.right.assetKey} with cacheStatus=${result.right.cacheStatus}.`,
          );

          return {
            normalizedText,
            audioUrl: result.right.url,
          } satisfies ResolvedSentence;
        }),
      { concurrency: 3 },
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
      const resolved = resolvedBySentence.get(normalizedText);

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
    const failedCount = resultItems.length - enrichedCount;

    yield* Effect.logInfo(
      `[SessionAudioEnrichment] Completed batch. enriched=${enrichedCount}, failed=${failedCount}, requested=${items.length}.`,
    );

    return {
      items: resultItems,
      requestedCount: items.length,
      enrichedCount,
      failedCount,
    };
  });
