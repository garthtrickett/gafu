import { Effect } from "effect";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AUDIO_CACHE_NAME,
  prewarmAudioUrls,
  type AudioPrewarmDependencies,
} from "./MediaPrewarmService.ts";

const makeDependencies = (
  fetchAudio: AudioPrewarmDependencies["fetchAudio"],
) => {
  const cached = new Map<string, Response>();
  const openCache = vi.fn(async () => ({
    match: async (request: string) =>
      cached.get(request),
    put: async (
      request: string,
      response: Response,
    ) => {
      cached.set(request, response);
    },
  }));

  return {
    dependencies: {
      openCache,
      fetchAudio,
    } satisfies AudioPrewarmDependencies,
    cached,
    openCache,
  };
};

describe("MediaPrewarmService", () => {
  it("caches absolute CORS-readable audio/mpeg URLs", async () => {
    const fetchAudio = vi.fn(async () =>
      new Response(
        new Uint8Array([0x49, 0x44, 0x33]),
        {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
          },
        },
      ),
    );
    const { dependencies, cached, openCache } =
      makeDependencies(fetchAudio);

    const result = await Effect.runPromise(
      prewarmAudioUrls(
        [
          "https://media.example.test/tts/a.mp3",
          "https://media.example.test/tts/a.mp3",
        ],
        dependencies,
      ),
    );

    expect(result).toEqual({
      targetCount: 1,
      alreadyCachedCount: 0,
      cachedCount: 1,
      failedCount: 0,
      skipped: false,
    });
    expect(openCache).toHaveBeenCalledWith(
      AUDIO_CACHE_NAME,
    );
    expect(cached.has(
      "https://media.example.test/tts/a.mp3",
    )).toBe(true);
  });

  it("does not refetch an audio asset already in the cache", async () => {
    const fetchAudio = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
        },
      }),
    );
    const { dependencies, cached } =
      makeDependencies(fetchAudio);
    cached.set(
      "https://media.example.test/tts/a.mp3",
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const result = await Effect.runPromise(
      prewarmAudioUrls(
        [
          "https://media.example.test/tts/a.mp3",
        ],
        dependencies,
      ),
    );

    expect(result.alreadyCachedCount).toBe(1);
    expect(result.cachedCount).toBe(0);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it("rejects responses with an incorrect content type", async () => {
    const fetchAudio = vi.fn(async () =>
      new Response("not audio", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      }),
    );
    const { dependencies, cached } =
      makeDependencies(fetchAudio);

    const result = await Effect.runPromise(
      prewarmAudioUrls(
        [
          "https://media.example.test/tts/bad.mp3",
        ],
        dependencies,
      ),
    );

    expect(result.cachedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(cached.size).toBe(0);
  });

  it("ignores non-HTTP URLs before touching the cache", async () => {
    const fetchAudio = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
        },
      }),
    );
    const { dependencies } =
      makeDependencies(fetchAudio);

    const result = await Effect.runPromise(
      prewarmAudioUrls(
        [
          "file:///tmp/audio.mp3",
          "data:audio/mpeg;base64,SUQz",
        ],
        dependencies,
      ),
    );

    expect(result.targetCount).toBe(0);
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});
