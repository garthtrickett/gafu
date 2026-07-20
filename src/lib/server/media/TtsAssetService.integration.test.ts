import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "effect";
import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";
import { makeFileSystemTtsAssetStorage } from "./FileSystemTtsAssetStorage.ts";
import {
  DEFAULT_JAPANESE_TTS_SETTINGS,
  makeTtsAssetService,
  type TtsAudioProvider,
} from "./TtsAssetService.ts";
import {
  makeGoogleTtsProvider,
  validateGoogleCredentialsEnvironment,
} from "./GoogleTtsProvider.ts";

const describeIntegration =
  process.env.RUN_GOOGLE_TTS_INTEGRATION === "1"
    ? describe
    : describe.skip;
const rootDirectory = resolve(
  "tmp/tts-integration",
  randomUUID(),
);

describeIntegration(
  "TtsAssetService Google integration",
  () => {
    afterAll(async () => {
      await rm(rootDirectory, {
        recursive: true,
        force: true,
      });
    });

    it(
      "calls Google once and returns a cache hit on the second resolution",
      async () => {
        await Effect.runPromise(
          validateGoogleCredentialsEnvironment(),
        );

        const googleProvider =
          makeGoogleTtsProvider();
        let providerCalls = 0;
        const countingProvider: TtsAudioProvider = {
          synthesize: (input) =>
            Effect.gen(function* () {
              providerCalls += 1;
              return yield* googleProvider.synthesize(
                input,
              );
            }),
        };
        const storage =
          makeFileSystemTtsAssetStorage({
            rootDirectory,
          });
        const service = makeTtsAssetService(
          countingProvider,
          storage,
        );

        const first = await Effect.runPromise(
          service.resolve({
            text: "今日は日本語の勉強を続けます。",
            settings:
              DEFAULT_JAPANESE_TTS_SETTINGS,
          }),
        );
        const second = await Effect.runPromise(
          service.resolve({
            text: "今日は日本語の勉強を続けます。",
            settings:
              DEFAULT_JAPANESE_TTS_SETTINGS,
          }),
        );

        expect(first.cacheStatus).toBe("miss");
        expect(second.cacheStatus).toBe("hit");
        expect(second.url).toBe(first.url);
        expect(providerCalls).toBe(1);
      },
      60_000,
    );
  },
);