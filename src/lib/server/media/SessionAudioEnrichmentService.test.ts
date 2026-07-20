import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  enrichSessionAudio,
  type SessionAudioRequestItem,
} from "./SessionAudioEnrichmentService.ts";
import {
  DEFAULT_JAPANESE_TTS_SETTINGS,
  TtsProviderError,
  type TtsAssetService,
} from "./TtsAssetService.ts";

const makeResolvedAsset = (
  text: string,
  index: number,
) => ({
  assetKey: `tts/test/${index}.mp3`,
  url: `https://media.example.test/tts/test/${index}.mp3`,
  normalizedText: text,
  settings: DEFAULT_JAPANESE_TTS_SETTINGS,
  cacheStatus: "miss" as const,
});

describe("SessionAudioEnrichmentService", () => {
  it("enriches fifteen requested cards with usable URLs", async () => {
    const resolvedTexts: string[] = [];
    const service: TtsAssetService = {
      resolve: (input) =>
        Effect.sync(() => {
          resolvedTexts.push(input.text);
          return makeResolvedAsset(
            input.text,
            resolvedTexts.length,
          );
        }),
    };
    const requests: SessionAudioRequestItem[] =
      Array.from({ length: 15 }, (_, index) => ({
        requestId: `card-${index}`,
        japaneseSentence: `例文${index}です。`,
      }));

    const result = await Effect.runPromise(
      enrichSessionAudio(requests, service),
    );

    expect(result.requestedCount).toBe(15);
    expect(result.enrichedCount).toBe(15);
    expect(result.failedCount).toBe(0);
    expect(result.items).toHaveLength(15);
    expect(
      result.items.every(
        (item) =>
          typeof item.audioUrl === "string" &&
          item.audioUrl.startsWith("https://"),
      ),
    ).toBe(true);
    expect(resolvedTexts).toHaveLength(15);
  });

  it("resolves duplicate sentences only once and reuses the asset URL", async () => {
    const resolvedTexts: string[] = [];
    const service: TtsAssetService = {
      resolve: (input) =>
        Effect.sync(() => {
          resolvedTexts.push(input.text);
          return makeResolvedAsset(
            input.text,
            resolvedTexts.length,
          );
        }),
    };
    const requests: SessionAudioRequestItem[] = [
      {
        requestId: "card-0",
        japaneseSentence: "同じ文です。",
      },
      {
        requestId: "card-1",
        japaneseSentence: "  同じ文です。  ",
      },
      {
        requestId: "card-2",
        japaneseSentence: "別の文です。",
      },
    ];

    const result = await Effect.runPromise(
      enrichSessionAudio(requests, service),
    );

    expect(resolvedTexts).toEqual([
      "同じ文です。",
      "別の文です。",
    ]);
    expect(result.items[0]?.audioUrl).toBe(
      result.items[1]?.audioUrl,
    );
    expect(result.items[2]?.audioUrl).not.toBe(
      result.items[0]?.audioUrl,
    );
  });

  it("keeps successful cards when one unique sentence fails", async () => {
    const service: TtsAssetService = {
      resolve: (input) =>
        Effect.gen(function* () {
          if (input.text === "失敗します。") {
            return yield* Effect.fail(
              new TtsProviderError({
                kind: "provider",
                message: "Synthetic provider failure.",
              }),
            );
          }

          return makeResolvedAsset(input.text, 1);
        }),
    };
    const requests: SessionAudioRequestItem[] = [
      {
        requestId: "card-0",
        japaneseSentence: "成功します。",
      },
      {
        requestId: "card-1",
        japaneseSentence: "失敗します。",
      },
      {
        requestId: "card-2",
        japaneseSentence: "成功します。",
      },
    ];

    const result = await Effect.runPromise(
      enrichSessionAudio(requests, service),
    );

    expect(result.enrichedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.items[0]?.audioUrl).toContain(
      "media.example.test",
    );
    expect(result.items[1]).toEqual({
      requestId: "card-1",
      audioUrl: null,
      failureKind: "provider",
    });
    expect(result.items[2]?.audioUrl).toBe(
      result.items[0]?.audioUrl,
    );
  });
});
