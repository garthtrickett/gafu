import { Effect } from "effect";

export const decodeSpeechEnvelope = (file: File) => Effect.acquireUseRelease(
  Effect.sync(() => new AudioContext()),
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
  (context) => Effect.promise(() => context.close()),
);
