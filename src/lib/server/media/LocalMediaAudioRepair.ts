import { Effect } from "effect";
import { resolve } from "node:path";
import {
  makeTemporaryMediaDirectory,
  removeTemporaryMediaDirectory,
  stageLocalMediaUpload,
} from "./LocalMediaAudioAnalysis.ts";

interface FfmpegRepairResult {
  readonly exitCode: number;
  readonly diagnostic: string;
}

const transcodeTemporaryMedia = (
  mediaPath: string,
  outputPath: string,
  receivedByteCount: number,
  abortSignal: AbortSignal,
): Effect.Effect<Uint8Array, Error> => Effect.gen(function* () {
  const process = yield* Effect.try({
    try: () => Bun.spawn([
      "ffmpeg",
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", mediaPath, "-map", "0:a:0", "-vn",
      "-c:a", "libopus", "-b:a", "128k", "-f", "ogg", outputPath,
    ], {
      stdout: "ignore",
      stderr: "pipe",
    }),
    catch: (cause) => new Error(`Local FFmpeg could not start: ${String(cause)}`),
  });
  const abort = () => process.kill();
  abortSignal.addEventListener("abort", abort, { once: true });
  if (abortSignal.aborted) abort();
  const result = yield* Effect.tryPromise({
    try: async (): Promise<FfmpegRepairResult> => {
      const [exitCode, diagnostic] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);
      return {
        exitCode,
        diagnostic: diagnostic.replaceAll(mediaPath, "<local-media>").trim().slice(-2_000),
      };
    },
    catch: (cause) => new Error(`Local FFmpeg audio repair failed: ${String(cause)}`),
  }).pipe(Effect.ensuring(Effect.sync(() => abortSignal.removeEventListener("abort", abort))));

  if (result.exitCode !== 0) {
    yield* Effect.logWarning("[LocalMediaAudioRepair] FFmpeg could not repair the selected audio track.", {
      exitCode: result.exitCode,
      diagnostic: result.diagnostic,
      receivedByteCount,
    });
    return yield* Effect.fail(new Error(
      result.diagnostic.length > 0
        ? `Local FFmpeg could not repair the audio track: ${result.diagnostic}`
        : `Local FFmpeg exited with code ${result.exitCode}.`,
    ));
  }

  const audioBytes = new Uint8Array(yield* Effect.tryPromise({
    try: () => Bun.file(outputPath).arrayBuffer(),
    catch: (cause) => new Error(`Could not read repaired audio: ${String(cause)}`),
  }));
  if (audioBytes.length === 0) {
    return yield* Effect.fail(new Error("Local FFmpeg returned an empty repaired audio track."));
  }
  yield* Effect.logInfo("[LocalMediaAudioRepair] Firefox-compatible audio repair completed.", {
    receivedByteCount,
    repairedByteCount: audioBytes.length,
  });
  return audioBytes;
});

export const repairLocalMediaAudio = (
  mediaStream: ReadableStream<Uint8Array> | null,
  abortSignal: AbortSignal,
): Effect.Effect<Uint8Array, Error> => Effect.gen(function* () {
  yield* Effect.logInfo("[LocalMediaAudioRepair] Starting loopback Firefox audio repair.");
  return yield* Effect.acquireUseRelease(
    makeTemporaryMediaDirectory,
    (temporaryDirectory) => Effect.gen(function* () {
      const upload = yield* stageLocalMediaUpload(mediaStream, temporaryDirectory);
      yield* Effect.logInfo("[LocalMediaAudioRepair] Local media upload staged for repair.", {
        receivedByteCount: upload.receivedByteCount,
      });
      return yield* transcodeTemporaryMedia(
        upload.mediaPath,
        resolve(temporaryDirectory, "firefox-audio.ogg"),
        upload.receivedByteCount,
        abortSignal,
      );
    }),
    removeTemporaryMediaDirectory,
  );
});
