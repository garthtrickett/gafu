import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { decodeSpeechEnvelopeWithFallback } from "./audio-analysis.ts";

describe("local media speech analysis", () => {
  const file = new File(["local media"], "episode.mkv", { type: "video/x-matroska" });

  it("sends a local video container to FFmpeg before allocating it in the browser decoder", async () => {
    const browserDecoder = vi.fn(() => Effect.fail(new Error("Browser decoder should not run.")));
    const loopbackDecoder = vi.fn(() => Effect.succeed(Float64Array.of(0.1, 0.8, 0.2)));
    const envelope = await Effect.runPromise(decodeSpeechEnvelopeWithFallback(
      file,
      browserDecoder,
      loopbackDecoder,
      "127.0.0.1",
    ));

    expect([...envelope]).toEqual([0.1, 0.8, 0.2]);
    expect(loopbackDecoder).toHaveBeenCalledOnce();
    expect(browserDecoder).not.toHaveBeenCalled();
  });

  it("falls back to localhost when the browser rejects an audio container", async () => {
    const audio = new File(["local audio"], "episode.m4a", { type: "audio/mp4" });
    const loopbackDecoder = vi.fn(() => Effect.succeed(Float64Array.of(0.2, 0.9)));
    const envelope = await Effect.runPromise(decodeSpeechEnvelopeWithFallback(
      audio,
      () => Effect.fail(new Error("Browser decoder rejected the audio container.")),
      loopbackDecoder,
      "localhost",
    ));

    expect([...envelope]).toEqual([0.2, 0.9]);
    expect(loopbackDecoder).toHaveBeenCalledOnce();
  });

  it("still tries browser decoding when local FFmpeg is not installed", async () => {
    const browserDecoder = vi.fn(() => Effect.succeed(Float64Array.of(0.3, 0.6)));
    const envelope = await Effect.runPromise(decodeSpeechEnvelopeWithFallback(
      file,
      browserDecoder,
      () => Effect.fail(new Error("Local FFmpeg could not start.")),
      "localhost",
    ));

    expect([...envelope]).toEqual([0.3, 0.6]);
    expect(browserDecoder).toHaveBeenCalledOnce();
  });

  it("never sends media to the helper from a non-loopback page", async () => {
    const loopbackDecoder = vi.fn(() => Effect.succeed(Float64Array.of(0.5)));
    const result = await Effect.runPromise(Effect.either(decodeSpeechEnvelopeWithFallback(
      file,
      () => Effect.fail(new Error("Browser decoder unavailable.")),
      loopbackDecoder,
      "life-io.xyz",
    )));

    expect(result._tag).toBe("Left");
    expect(loopbackDecoder).not.toHaveBeenCalled();
  });
});
