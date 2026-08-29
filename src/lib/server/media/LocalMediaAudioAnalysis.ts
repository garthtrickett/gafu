import { Effect } from "effect";
import { pcm16LittleEndianBytesToEnvelope } from "../../shared/adaptive-audio-envelope.ts";

interface FfmpegAnalysisResult {
  readonly exitCode: number;
  readonly pcmBytes: Uint8Array;
  readonly diagnostic: string;
}

export const extractLocalMediaSpeechEnvelope = (
  mediaStream: ReadableStream<Uint8Array> | null,
  abortSignal: AbortSignal,
): Effect.Effect<Float64Array, Error> => Effect.gen(function* () {
  if (!mediaStream) return yield* Effect.fail(new Error("The local media request contained no bytes."));

  yield* Effect.logInfo("[LocalMediaAudioAnalysis] Starting loopback FFmpeg analysis.");
  const result = yield* Effect.tryPromise({
    try: async (): Promise<FfmpegAnalysisResult> => {
      const process = Bun.spawn([
        "ffmpeg",
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", "pipe:0", "-map", "0:a:0", "-vn",
        "-ac", "1", "-ar", "1000",
        "-af", "highpass=f=180,lowpass=f=4000",
        "-f", "s16le", "pipe:1",
      ], {
        stdin: mediaStream,
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
        diagnostic: diagnostic.trim().slice(-2_000),
      };
    },
    catch: (cause) => new Error(`Local FFmpeg could not start: ${String(cause)}`),
  });

  if (result.exitCode !== 0) {
    yield* Effect.logWarning("[LocalMediaAudioAnalysis] FFmpeg could not decode the selected audio track.", {
      exitCode: result.exitCode,
      diagnostic: result.diagnostic,
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
