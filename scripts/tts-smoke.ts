import {
  copyFile,
  mkdir,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { makeFileSystemTtsAssetStorage } from "../src/lib/server/media/FileSystemTtsAssetStorage.ts";
import {
  DEFAULT_JAPANESE_TTS_SETTINGS,
  makeTtsAssetService,
} from "../src/lib/server/media/TtsAssetService.ts";
import {
  makeGoogleTtsProvider,
  validateGoogleCredentialsEnvironment,
} from "../src/lib/server/media/GoogleTtsProvider.ts";
import { DEFAULT_GOOGLE_TTS_SMOKE_TEXT } from "../src/lib/server/tts/GoogleTtsProbe.ts";

const outputPath = resolve(
  process.env.GOOGLE_TTS_SMOKE_OUTPUT_PATH?.trim() ||
    "tmp/tts-smoke/ja-JP-Neural2-B.mp3",
);
const assetRoot = resolve("tmp/tts-smoke/assets");
const smokeText =
  process.env.GOOGLE_TTS_SMOKE_TEXT?.trim() ||
  DEFAULT_GOOGLE_TTS_SMOKE_TEXT;

class SmokeOutputError extends Data.TaggedError(
  "SmokeOutputError",
)<{
  readonly message: string;
}> {}

const provider = makeGoogleTtsProvider();
const storage = makeFileSystemTtsAssetStorage({
  rootDirectory: assetRoot,
});
const service = makeTtsAssetService(provider, storage);

const program = Effect.gen(function* () {
  yield* validateGoogleCredentialsEnvironment();

  const asset = yield* service.resolve({
    text: smokeText,
    settings: DEFAULT_JAPANESE_TTS_SETTINGS,
  });

  const canonicalPath = yield* Effect.try({
    try: () => fileURLToPath(asset.url),
    catch: () =>
      new SmokeOutputError({
        message:
          "The smoke storage returned a non-file URL.",
      }),
  });

  yield* Effect.tryPromise({
    try: () =>
      mkdir(dirname(outputPath), {
        recursive: true,
      }).then(() =>
        copyFile(canonicalPath, outputPath),
      ),
    catch: () =>
      new SmokeOutputError({
        message:
          "Unable to write the smoke MP3 output.",
      }),
  });

  yield* Effect.logInfo(
    `[GoogleTtsSmoke] ${asset.cacheStatus === "hit" ? "Cache hit" : "Cache miss"} for ${asset.assetKey}.`,
  );
  yield* Effect.logInfo(
    `[GoogleTtsSmoke] Playable copy written to ${outputPath}.`,
  );

  return {
    asset,
    outputPath,
  };
});

Effect.runPromise(Effect.either(program)).then(
  (result) => {
    if (result._tag === "Left") {
      process.stderr.write(
        `[GoogleTtsSmoke] ${result.left.message}\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `[GoogleTtsSmoke] Success (${result.right.asset.cacheStatus}). Play the MP3 at: ${result.right.outputPath}\n`,
    );
  },
  () => {
    process.stderr.write(
      "[GoogleTtsSmoke] The Google TTS smoke probe failed unexpectedly.\n",
    );
    process.exitCode = 1;
  },
);
