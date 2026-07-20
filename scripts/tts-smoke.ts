import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Data, Effect } from "effect";
import {
  DEFAULT_GOOGLE_TTS_SMOKE_TEXT,
  GoogleTtsProbeError,
  synthesizeGoogleTtsProbe,
} from "../src/lib/server/tts/GoogleTtsProbe.ts";

const outputPath = resolve(
  process.env.GOOGLE_TTS_SMOKE_OUTPUT_PATH?.trim() ||
    "tmp/tts-smoke/ja-JP-Neural2-B.mp3",
);
const smokeText =
  process.env.GOOGLE_TTS_SMOKE_TEXT?.trim() ||
  DEFAULT_GOOGLE_TTS_SMOKE_TEXT;

class SmokeWriteError extends Data.TaggedError("SmokeWriteError")<{
  readonly message: string;
}> {}

const program = Effect.gen(function* () {
  const audio = yield* synthesizeGoogleTtsProbe(smokeText);

  yield* Effect.tryPromise({
    try: () =>
      mkdir(dirname(outputPath), { recursive: true }).then(() =>
        writeFile(outputPath, audio),
      ),
    catch: () =>
      new SmokeWriteError({
        message: `Unable to write the smoke MP3 to ${outputPath}.`,
      }),
  });

  yield* Effect.logInfo(
    `[GoogleTtsSmoke] Wrote ${audio.byteLength} bytes to ${outputPath}.`,
  );
  return outputPath;
});

Effect.runPromise(program).then(
  (path) => {
    process.stdout.write(
      `[GoogleTtsSmoke] Success. Play the MP3 at: ${path}\n`,
    );
  },
  (error: unknown) => {
    const message =
      error instanceof GoogleTtsProbeError ||
      error instanceof SmokeWriteError
        ? error.message
        : "The Google TTS smoke probe failed unexpectedly.";
    process.stderr.write(`[GoogleTtsSmoke] ${message}\n`);
    process.exitCode = 1;
  },
);