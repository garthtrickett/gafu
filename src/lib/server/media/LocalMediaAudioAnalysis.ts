import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pcm16LittleEndianBytesToEnvelope } from "../../shared/adaptive-audio-envelope.ts";

interface FfmpegAnalysisResult {
  readonly exitCode: number;
  readonly pcmBytes: Uint8Array;
  readonly diagnostic: string;
  readonly receivedByteCount: number;
}

export interface MediaInputSink {
  readonly write: (chunk: Uint8Array) => number | Promise<number>;
  readonly flush: () => number | Promise<number>;
  readonly end: () => number | Promise<number>;
}

export interface MediaStreamPumpResult {
  readonly receivedByteCount: number;
  readonly writeFailed: boolean;
}

export interface StagedLocalMedia {
  readonly mediaPath: string;
  readonly receivedByteCount: number;
}

const settleSinkOperation = (
  operation: () => number | Promise<number>,
): Promise<boolean> => Promise.resolve()
  .then(operation)
  .then(() => true, () => false);

export const pumpMediaStream = async (
  mediaStream: ReadableStream<Uint8Array>,
  sink: MediaInputSink,
): Promise<MediaStreamPumpResult> => {
  const reader = mediaStream.getReader();
  let receivedByteCount = 0;
  let inputOpen = true;
  let next = await reader.read();
  while (!next.done) {
    const chunk = next.value ?? new Uint8Array();
    receivedByteCount += chunk.byteLength;
    if (inputOpen) {
      inputOpen = await settleSinkOperation(() => {
        sink.write(chunk);
        return sink.flush();
      });
    } else {
      inputOpen = false;
    }
    next = await reader.read();
  }
  if (inputOpen) inputOpen = await settleSinkOperation(() => sink.end());
  return { receivedByteCount, writeFailed: !inputOpen };
};

export const makeTemporaryMediaDirectory = Effect.try({
  try: () => mkdtempSync(resolve(tmpdir(), "gafu-local-media-")),
  catch: (cause) => new Error(`Could not create local media workspace: ${String(cause)}`),
});

export const removeTemporaryMediaDirectory = (temporaryDirectory: string) => Effect.gen(function* () {
  const cleanup = yield* Effect.either(Effect.try({
    try: () => rmSync(temporaryDirectory, { recursive: true, force: true }),
    catch: (cause) => new Error(`Could not remove local media workspace: ${String(cause)}`),
  }));
  if (cleanup._tag === "Left") {
    yield* Effect.logWarning("[LocalMediaAudioAnalysis] Temporary media cleanup failed.", {
      reason: cleanup.left.message,
    });
  }
});

export const stageLocalMediaUpload = (
  mediaStream: ReadableStream<Uint8Array> | null,
  temporaryDirectory: string,
): Effect.Effect<StagedLocalMedia, Error> => Effect.gen(function* () {
  if (!mediaStream) return yield* Effect.fail(new Error("The local media request contained no bytes."));
  const mediaPath = resolve(temporaryDirectory, "media-input");
  const upload = yield* Effect.tryPromise({
    try: () => pumpMediaStream(mediaStream, Bun.file(mediaPath).writer({ highWaterMark: 1024 * 1024 })),
    catch: (cause) => new Error(`Could not stage local media for FFmpeg: ${String(cause)}`),
  });
  if (upload.writeFailed) {
    return yield* Effect.fail(new Error("Could not stage the complete local media file for FFmpeg."));
  }
  return { mediaPath, receivedByteCount: upload.receivedByteCount };
});

export const extractLocalMediaSpeechEnvelope = (
  mediaStream: ReadableStream<Uint8Array> | null,
  abortSignal: AbortSignal,
): Effect.Effect<Float64Array, Error> => Effect.gen(function* () {
  yield* Effect.logInfo("[LocalMediaAudioAnalysis] Starting loopback FFmpeg analysis.");
  return yield* Effect.acquireUseRelease(
    makeTemporaryMediaDirectory,
    (temporaryDirectory) => Effect.gen(function* () {
      const upload = yield* stageLocalMediaUpload(mediaStream, temporaryDirectory);
      yield* Effect.logInfo("[LocalMediaAudioAnalysis] Local media upload staged for analysis.", {
        receivedByteCount: upload.receivedByteCount,
      });
      return yield* analyzeTemporaryMedia(upload.mediaPath, upload.receivedByteCount, abortSignal);
    }),
    removeTemporaryMediaDirectory,
  );
});

const analyzeTemporaryMedia = (
  mediaPath: string,
  receivedByteCount: number,
  abortSignal: AbortSignal,
): Effect.Effect<Float64Array, Error> => Effect.gen(function* () {
  const result = yield* Effect.tryPromise({
    try: async (): Promise<FfmpegAnalysisResult> => {
      const process = Bun.spawn([
        "ffmpeg",
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", mediaPath, "-map", "0:a:0", "-vn",
        "-ac", "1", "-ar", "1000",
        "-af", "highpass=f=180,lowpass=f=4000",
        "-f", "s16le", "pipe:1",
      ], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const abort = () => process.kill();
      abortSignal.addEventListener("abort", abort, { once: true });
      const [exitCode, pcmBuffer, diagnostic] = await Promise.all([
        process.exited,
        new Response(process.stdout).arrayBuffer(),
        new Response(process.stderr).text(),
      ]);
      abortSignal.removeEventListener("abort", abort);
      return {
        exitCode,
        pcmBytes: new Uint8Array(pcmBuffer),
        diagnostic: diagnostic.replaceAll(mediaPath, "<local-media>").trim().slice(-2_000),
        receivedByteCount,
      };
    },
    catch: (cause) => new Error(`Local FFmpeg could not start: ${String(cause)}`),
  });

  if (result.exitCode !== 0) {
    yield* Effect.logWarning("[LocalMediaAudioAnalysis] FFmpeg could not decode the selected audio track.", {
      exitCode: result.exitCode,
      diagnostic: result.diagnostic,
      receivedByteCount: result.receivedByteCount,
    });
    return yield* Effect.fail(new Error(
      result.diagnostic.length > 0
        ? `Local FFmpeg could not decode the audio track: ${result.diagnostic}`
        : `Local FFmpeg exited with code ${result.exitCode}.`,
    ));
  }

  const envelope = pcm16LittleEndianBytesToEnvelope(result.pcmBytes);
  if (envelope.length < 100) {
    yield* Effect.logWarning("[LocalMediaAudioAnalysis] Decoded audio was too short for alignment.", {
      frameCount: envelope.length,
    });
    return yield* Effect.fail(new Error("The decoded audio track is too short for automatic alignment."));
  }
  yield* Effect.logInfo("[LocalMediaAudioAnalysis] Loopback FFmpeg analysis completed.", {
    frameCount: envelope.length,
  });
  return envelope;
});
