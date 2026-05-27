import { Effect, Schedule } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const PREWARM_WINDOW_SIZE = 10; // Number of future review cards to prewarm
const CACHE_NAME = "learning-audio-media";

interface CardMetadata {
  readonly id: string;
  readonly audioUrl?: string;
  readonly nextReview: string;
}

const getUpcomingReviewAudioUrls = () =>
  Effect.gen(function* () {
    const { srsStore } = yield* Effect.promise(() => import("../stores/srsStore"));

    const srsList = srsStore.state.peek() as CardMetadata[];
    const now = Date.now();

    const sortedUpcoming = [...srsList]
      .filter((c) => c.audioUrl && new Date(c.nextReview).getTime() > now - 86400000)
      .sort((a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime())
      .slice(0, PREWARM_WINDOW_SIZE);

    const urls = sortedUpcoming
      .map((c) => c.audioUrl)
      .filter((url): url is string => typeof url === "string" && url.startsWith("http"));

    return urls;
  });

export const runPrewarmCycle = () =>
  Effect.gen(function* () {
    if (!isOnlineState.value) {
      yield* clientLog("debug", "[MediaPrewarm] Offline. Skipping prewarm loop.");
      return;
    }

    if (!('caches' in window)) {
      return;
    }

    const targetUrls = yield* getUpcomingReviewAudioUrls();
    if (targetUrls.length === 0) return;

    yield* clientLog("info", `[MediaPrewarm] Scanning queue. Validating ${targetUrls.length} assets...`);

    const cache = yield* Effect.tryPromise({
      try: () => caches.open(CACHE_NAME),
      catch: (e) => new Error(`Failed to open Cache API: ${String(e)}`),
    });

    const missingUrls: string[] = [];

    for (const url of targetUrls) {
      const match = yield* Effect.promise(() => cache.match(url));
      if (!match) {
        missingUrls.push(url);
      }
    }

    if (missingUrls.length === 0) {
      yield* clientLog("debug", "[MediaPrewarm] All upcoming audio assets are cached locally.");
      return;
    }

    yield* clientLog("info", `[MediaPrewarm] Prefetching ${missingUrls.length} missing audio assets...`);

        yield* Effect.forEach(
      missingUrls,
      (url) =>
        Effect.tryPromise({
          try: () =>
            fetch(url, { mode: "cors", priority: "low" }).then(async (res) => {
              if (res.ok) {
                await cache.put(url, res);
              } else {
                throw new Error(`Server returned HTTP status ${res.status}`);
              }
            }),
          catch: (e) => new Error(`Fetch failed for ${url}: ${String(e)}`),
        }).pipe(
          Effect.catchAll((err) =>
            clientLog("warn", `[MediaPrewarm] Failed to prewarm asset: ${url}`, err)
          )
        ),
      { concurrency: 3 }
    );

    yield* clientLog("info", "[MediaPrewarm] Prefetching cycle complete.");
  });

export const startMediaPrewarmEngine = () => {
  const prewarmSchedule = Schedule.spaced("5 minutes");
  const prewarmLoop = Effect.gen(function* () {
    yield* runPrewarmCycle();
  }).pipe(
    Effect.catchAll((err) =>
      clientLog("error", "[MediaPrewarm] Prewarm loop failed", err)
    ),
    Effect.repeat(prewarmSchedule)
  );

  runClientUnscoped(prewarmLoop);
};
