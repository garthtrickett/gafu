import { Effect, Schedule } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const PREWARM_WINDOW_SIZE = 30;
export const AUDIO_CACHE_NAME = "learning-audio-media";

interface CardMetadata {
  readonly audioUrl?: string | null;
  readonly nextReview: string;
}

interface AudioCacheLike {
  readonly match: (
    request: string,
  ) => Promise<Response | undefined>;
  readonly put: (
    request: string,
    response: Response,
  ) => Promise<void>;
}

export interface AudioPrewarmDependencies {
  readonly openCache: (
    cacheName: string,
  ) => Promise<AudioCacheLike>;
  readonly fetchAudio: (
    url: string,
    init: RequestInit,
  ) => Promise<Response>;
}

export interface AudioPrewarmSummary {
  readonly targetCount: number;
  readonly alreadyCachedCount: number;
  readonly cachedCount: number;
  readonly failedCount: number;
  readonly skipped: boolean;
}

const browserDependencies =
  (): AudioPrewarmDependencies | null => {
    if (
      typeof caches === "undefined" ||
      typeof fetch === "undefined"
    ) {
      return null;
    }

    return {
      openCache: (cacheName) =>
        caches.open(cacheName),
      fetchAudio: (url, init) =>
        fetch(url, init),
    };
  };

const normalizedAudioUrls = (
  urls: readonly string[],
): readonly string[] =>
  [
    ...new Set(
      urls
        .map((url) => url.trim())
        .filter(
          (url) =>
            URL.canParse(url) &&
            (
              new URL(url).protocol === "http:" ||
              new URL(url).protocol === "https:"
            ),
        ),
    ),
  ];

const normalizedContentType = (
  response: Response,
): string =>
  response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";

export const prewarmAudioUrls = (
  urls: readonly string[],
  dependencies?: AudioPrewarmDependencies,
): Effect.Effect<AudioPrewarmSummary, Error> =>
  Effect.gen(function* () {
    const targetUrls = normalizedAudioUrls(urls);
    const resolvedDependencies =
      dependencies ?? browserDependencies();

    if (!resolvedDependencies) {
      yield* clientLog(
        "debug",
        "[MediaPrewarm] Cache API unavailable; audio prewarm skipped.",
      );
      return {
        targetCount: targetUrls.length,
        alreadyCachedCount: 0,
        cachedCount: 0,
        failedCount: 0,
        skipped: true,
      };
    }

    if (targetUrls.length === 0) {
      return {
        targetCount: 0,
        alreadyCachedCount: 0,
        cachedCount: 0,
        failedCount: 0,
        skipped: false,
      };
    }

    const cache = yield* Effect.tryPromise({
      try: () =>
        resolvedDependencies.openCache(
          AUDIO_CACHE_NAME,
        ),
      catch: (cause) =>
        new Error(
          `Failed to open the audio Cache API store: ${String(cause)}`,
        ),
    });

    let alreadyCachedCount = 0;
    const missingUrls: string[] = [];

    for (const url of targetUrls) {
      const match = yield* Effect.tryPromise({
        try: () => cache.match(url),
        catch: (cause) =>
          new Error(
            `Failed to inspect the audio cache: ${String(cause)}`,
          ),
      });

      if (match) {
        alreadyCachedCount += 1;
      } else {
        missingUrls.push(url);
      }
    }

    yield* clientLog(
      "info",
      `[MediaPrewarm] Preparing ${missingUrls.length} uncached audio assets from ${targetUrls.length} targets.`,
    );

    const outcomes = yield* Effect.forEach(
      missingUrls,
      (url) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            Effect.tryPromise({
              try: () =>
                resolvedDependencies.fetchAudio(url, {
                  mode: "cors",
                  credentials: "omit",
                  priority: "low",
                }),
              catch: (cause) =>
                new Error(
                  `Audio fetch failed: ${String(cause)}`,
                ),
            }),
          );

          if (result._tag === "Left") {
            yield* clientLog(
              "warn",
              `[MediaPrewarm] Network failure while prewarming ${url}.`,
              result.left,
            );
            return false;
          }

          const response = result.right;
          const contentType =
            normalizedContentType(response);

          if (
            !response.ok ||
            response.type === "opaque" ||
            contentType !== "audio/mpeg"
          ) {
            yield* clientLog(
              "warn",
              `[MediaPrewarm] Rejected audio response url=${url} status=${response.status} type=${response.type} contentType=${contentType || "missing"}.`,
            );
            return false;
          }

          const cacheResult = yield* Effect.either(
            Effect.tryPromise({
              try: () =>
                cache.put(url, response.clone()),
              catch: (cause) =>
                new Error(
                  `Failed to cache audio: ${String(cause)}`,
                ),
            }),
          );

          if (cacheResult._tag === "Left") {
            yield* clientLog(
              "warn",
              `[MediaPrewarm] Cache write failed for ${url}.`,
              cacheResult.left,
            );
            return false;
          }

          yield* clientLog(
            "info",
            `[MediaPrewarm] Cached audio asset ${url}.`,
          );
          return true;
        }),
      { concurrency: 3 },
    );

    const cachedCount = outcomes.filter(Boolean).length;
    const failedCount =
      outcomes.length - cachedCount;

    yield* clientLog(
      failedCount > 0 ? "warn" : "info",
      `[MediaPrewarm] Cycle complete. targets=${targetUrls.length}, existing=${alreadyCachedCount}, cached=${cachedCount}, failed=${failedCount}.`,
    );

    return {
      targetCount: targetUrls.length,
      alreadyCachedCount,
      cachedCount,
      failedCount,
      skipped: false,
    };
  });

const getUpcomingReviewAudioUrls = () =>
  Effect.gen(function* () {
    const { srsStore } = yield* Effect.promise(
      () => import("../stores/srsStore"),
    );
    const { activeSessionStore } =
      yield* Effect.promise(
        () =>
          import(
            "../stores/activeSessionStore.ts"
          ),
      );

    const srsList =
      srsStore.state.peek() as CardMetadata[];
    const now = Date.now();

    const upcomingSrsUrls = [...srsList]
      .filter(
        (card) =>
          card.audioUrl &&
          new Date(card.nextReview).getTime() >
            now - 86_400_000,
      )
      .sort(
        (left, right) =>
          new Date(left.nextReview).getTime() -
          new Date(right.nextReview).getTime(),
      )
      .flatMap((card) =>
        typeof card.audioUrl === "string"
          ? [card.audioUrl]
          : [],
      );

    const activeSessionUrls =
      activeSessionStore.masterList
        .peek()
        .flatMap((card) =>
          typeof card.audioUrl === "string"
            ? [card.audioUrl]
            : [],
        );

    return normalizedAudioUrls([
      ...activeSessionUrls,
      ...upcomingSrsUrls,
    ]).slice(0, PREWARM_WINDOW_SIZE);
  });

export const runPrewarmCycle = () =>
  Effect.gen(function* () {
    if (!isOnlineState.value) {
      yield* clientLog(
        "debug",
        "[MediaPrewarm] Offline. Skipping prewarm loop.",
      );
      return;
    }

    const targetUrls =
      yield* getUpcomingReviewAudioUrls();

    if (targetUrls.length === 0) {
      yield* clientLog(
        "debug",
        "[MediaPrewarm] No audio targets are currently eligible for prewarming.",
      );
      return;
    }

    yield* prewarmAudioUrls(targetUrls);
  });

export const startMediaPrewarmEngine = () => {
  const prewarmSchedule =
    Schedule.spaced("5 minutes");
  const prewarmLoop = Effect.gen(function* () {
    yield* runPrewarmCycle();
  }).pipe(
    Effect.catchAll((error) =>
      clientLog(
        "error",
        "[MediaPrewarm] Prewarm loop failed",
        error,
      ),
    ),
    Effect.repeat(prewarmSchedule),
  );

  runClientUnscoped(prewarmLoop);
};
