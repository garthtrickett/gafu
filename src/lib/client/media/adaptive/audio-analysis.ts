import { Effect } from "effect";
import { clientLog } from "../../clientLog.ts";
import {
  LOCAL_MEDIA_HELPER_HEADER,
  LOCAL_MEDIA_HELPER_VERSION,
  isLoopbackHostname,
} from "../../../shared/local-media-helper.ts";

export type SpeechEnvelopeDecoder = (file: File) => Effect.Effect<Float64Array, Error>;

const isVideoContainer = (file: File): boolean =>
  file.type.startsWith("video/") || /\.(?:avi|m4v|mkv|mov|mp4|webm)$/iu.test(file.name);

const decodeSpeechEnvelopeInBrowser: SpeechEnvelopeDecoder = (file) => Effect.acquireUseRelease(
  Effect.try({
    try: () => new AudioContext(),
    catch: (cause) => new Error(`Browser audio context unavailable: ${String(cause)}`),
  }),
  (context) => Effect.tryPromise({
    try: async () => {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const samplesPerFrame = Math.max(1, Math.round(decoded.sampleRate / 10));
      const frames = Math.floor(decoded.length / samplesPerFrame);
      const envelope = new Float64Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let squares = 0;
        let samples = 0;
        const start = frame * samplesPerFrame;
        const end = Math.min(decoded.length, start + samplesPerFrame);
        for (let index = start; index < end; index += 1) {
          let mono = 0;
          for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) mono += decoded.getChannelData(channel)[index] ?? 0;
          mono /= decoded.numberOfChannels;
          squares += mono * mono;
          samples += 1;
        }
        envelope[frame] = Math.log1p(Math.sqrt(squares / Math.max(1, samples)) * 100);
      }
      const sorted = [...envelope].sort((left, right) => left - right);
      const floor = sorted[Math.floor(sorted.length * 0.15)] ?? 0;
      const ceiling = sorted[Math.floor(sorted.length * 0.9)] ?? 1;
      const range = Math.max(0.0001, ceiling - floor);
      return Float64Array.from(envelope, (value) => Math.min(1, Math.max(0, (value - floor) / range)));
    },
    catch: (cause) => new Error(`Browser audio decoding unavailable: ${String(cause)}`),
  }),
  (context) => Effect.gen(function* () {
    yield* Effect.either(Effect.tryPromise({
      try: () => context.close(),
      catch: (cause) => new Error(`Browser audio context could not close: ${String(cause)}`),
    }));
  }),
);

const decodeSpeechEnvelopeWithLoopbackFfmpeg: SpeechEnvelopeDecoder = (file) => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/local-media/audio-envelope", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_HELPER_VERSION,
      },
      body: file,
    }),
    catch: (cause) => new Error(`Could not reach the local media helper: ${String(cause)}`),
  });
  if (!response.ok) {
    const payloadResult = yield* Effect.either(Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) => new Error(`Local media helper returned invalid JSON: ${String(cause)}`),
    }));
    const payload = payloadResult._tag === "Right" ? payloadResult.right : null;
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Local media helper returned HTTP ${response.status}.`;
    return yield* Effect.fail(new Error(message));
  }

  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) => new Error(`Local media helper returned invalid JSON: ${String(cause)}`),
  });
  if (typeof payload !== "object" || payload === null || !("envelope" in payload) || !Array.isArray(payload.envelope)) {
    return yield* Effect.fail(new Error("Local media helper returned an invalid speech envelope."));
  }
  if (payload.envelope.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return yield* Effect.fail(new Error("Local media helper returned non-numeric speech data."));
  }
  return Float64Array.from(payload.envelope);
});

export const decodeSpeechEnvelopeWithFallback = (
  file: File,
  browserDecoder: SpeechEnvelopeDecoder,
  loopbackDecoder: SpeechEnvelopeDecoder,
  hostname: string,
): Effect.Effect<Float64Array, Error> => Effect.gen(function* () {
  const loopbackPage = isLoopbackHostname(hostname);
  let loopbackFailure: Error | null = null;
  if (loopbackPage && isVideoContainer(file)) {
    yield* clientLog("info", "[AudioAnalysis] Sending the local video container directly to localhost FFmpeg.", {
      byteCount: file.size,
    });
    const loopbackResult = yield* Effect.either(loopbackDecoder(file));
    if (loopbackResult._tag === "Right") {
      yield* clientLog("info", "[AudioAnalysis] Localhost FFmpeg analysis completed.", {
        frameCount: loopbackResult.right.length,
      });
      return loopbackResult.right;
    }
    loopbackFailure = loopbackResult.left;
    yield* clientLog("warn", "[AudioAnalysis] Localhost FFmpeg could not analyze the video container; trying the browser decoder.", {
      reason: loopbackResult.left.message,
    });
  }

  const browserResult = yield* Effect.either(browserDecoder(file));
  if (browserResult._tag === "Right") {
    yield* clientLog("info", "[AudioAnalysis] Browser audio decoding completed.", {
      frameCount: browserResult.right.length,
    });
    return browserResult.right;
  }

  yield* clientLog("warn", "[AudioAnalysis] Browser decoder could not analyze the selected container.", {
    reason: browserResult.left.message,
    loopbackPage,
  });
  if (!loopbackPage) return yield* Effect.fail(browserResult.left);
  if (loopbackFailure) return yield* Effect.fail(loopbackFailure);

  yield* clientLog("info", "[AudioAnalysis] Trying the localhost FFmpeg fallback.", {
    byteCount: file.size,
  });
  const envelope = yield* loopbackDecoder(file);
  yield* clientLog("info", "[AudioAnalysis] Localhost FFmpeg fallback completed.", {
    frameCount: envelope.length,
  });
  return envelope;
});

export const decodeSpeechEnvelope = (file: File) => decodeSpeechEnvelopeWithFallback(
  file,
  decodeSpeechEnvelopeInBrowser,
  decodeSpeechEnvelopeWithLoopbackFfmpeg,
  window.location.hostname,
);
