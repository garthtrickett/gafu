import { Buffer } from "node:buffer";
import { Effect } from "effect";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  DEFAULT_JAPANESE_TTS_SETTINGS,
  TtsProviderError,
  buildTtsAssetKey,
  makeTtsAssetService,
  normalizeTtsText,
  type TtsAssetStorage,
  type TtsAudioProvider,
  type TtsProviderInput,
} from "./TtsAssetService.ts";

const validMp3 = Buffer.from([
  0x49,
  0x44,
  0x33,
  0x04,
  0x00,
  0x00,
]);

const makeHarness = () => {
  const assets = new Map<string, string>();
  const synthesize = vi.fn(
    (_input: TtsProviderInput) =>
      Effect.succeed(validMp3),
  );
  const find = vi.fn((assetKey: string) =>
    Effect.succeed(assets.get(assetKey) ?? null),
  );
  const put = vi.fn(
    (input: {
      readonly assetKey: string;
      readonly audio: Buffer;
      readonly contentType: "audio/mpeg";
    }) =>
      Effect.sync(() => {
        const url = `https://media.test/${input.assetKey}`;
        assets.set(input.assetKey, url);
        return url;
      }),
  );

  const provider: TtsAudioProvider = {
    synthesize,
  };
  const storage: TtsAssetStorage = {
    find,
    put,
  };

  return {
    assets,
    find,
    put,
    synthesize,
    service: makeTtsAssetService(provider, storage),
  };
};

describe("TtsAssetService", () => {
  it("normalizes equivalent text into one deterministic asset", async () => {
    const harness = makeHarness();

    const first = await Effect.runPromise(
      harness.service.resolve({
        text: "　今日は   日本語を勉強します。　",
      }),
    );
    const second = await Effect.runPromise(
      harness.service.resolve({
        text: "今日は 日本語を勉強します。",
      }),
    );

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.assetKey).toBe(first.assetKey);
    expect(second.url).toBe(first.url);
    expect(harness.synthesize).toHaveBeenCalledTimes(1);
    expect(harness.put).toHaveBeenCalledTimes(1);
  });

  it("includes voice, rate, encoding, and version in the identity", () => {
    const text = normalizeTtsText(
      "今日は日本語を勉強します。",
    );
    const base = buildTtsAssetKey(
      text,
      DEFAULT_JAPANESE_TTS_SETTINGS,
    );

    expect(base).toContain("/mp3/");
    expect(
      buildTtsAssetKey(text, {
        ...DEFAULT_JAPANESE_TTS_SETTINGS,
        voiceName: "ja-JP-Neural2-C",
      }),
    ).not.toBe(base);
    expect(
      buildTtsAssetKey(text, {
        ...DEFAULT_JAPANESE_TTS_SETTINGS,
        speakingRate: 1,
      }),
    ).not.toBe(base);
    expect(
      buildTtsAssetKey(text, {
        ...DEFAULT_JAPANESE_TTS_SETTINGS,
        audioEncoding: "MP3",
        synthesisVersion: 2,
      }),
    ).not.toBe(base);
  });

  it("returns an existing asset without calling the provider", async () => {
    const harness = makeHarness();
    const normalizedText = normalizeTtsText(
      "今日は日本語を勉強します。",
    );
    const assetKey = buildTtsAssetKey(
      normalizedText,
      DEFAULT_JAPANESE_TTS_SETTINGS,
    );
    harness.assets.set(
      assetKey,
      `https://media.test/${assetKey}`,
    );

    const result = await Effect.runPromise(
      harness.service.resolve({
        text: normalizedText,
      }),
    );

    expect(result.cacheStatus).toBe("hit");
    expect(harness.synthesize).not.toHaveBeenCalled();
    expect(harness.put).not.toHaveBeenCalled();
  });

  it("does not persist an asset when synthesis fails", async () => {
    const storageHarness = makeHarness();
    const provider: TtsAudioProvider = {
      synthesize: vi.fn(() =>
        Effect.fail(
          new TtsProviderError({
            kind: "provider",
            message: "Synthetic provider failure.",
          }),
        ),
      ),
    };
    const service = makeTtsAssetService(
      provider,
      {
        find: storageHarness.find,
        put: storageHarness.put,
      },
    );

    const result = await Effect.runPromise(
      Effect.either(
        service.resolve({
          text: "今日は日本語を勉強します。",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(storageHarness.put).not.toHaveBeenCalled();
  });

  it("rejects empty text before checking storage", async () => {
    const harness = makeHarness();

    const result = await Effect.runPromise(
      Effect.either(
        harness.service.resolve({
          text: "　   ",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(harness.find).not.toHaveBeenCalled();
    expect(harness.synthesize).not.toHaveBeenCalled();
  });
});