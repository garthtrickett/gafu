import { createStore, get, set } from "idb-keyval";
import { Effect, Schedule } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const DB_NAME = "bedrock-lang-sync-v1";
const STORE_NAME = "metadata";
const syncMetadataStore = createStore(DB_NAME, STORE_NAME);
const LAST_PULL_KEY = "last_pull_timestamp";

interface DeltaResponse {
  readonly serverTimestamp: number;
  readonly decks: Array<{ id: string; name: string; category: string; content: unknown }>;
  readonly srsUpdates: Array<{ id: string; easeFactor: number; repetitions: number; nextReview: string }>;
}

const getStoredPullTimestamp = (): Promise<number> => {
  return get<number>(LAST_PULL_KEY, syncMetadataStore).then((ts) => ts || 0);
};

const savePullTimestamp = (ts: number): Promise<void> => {
  return set(LAST_PULL_KEY, ts, syncMetadataStore);
};

export const executeDeltaPull = ()
  => Effect.gen(function* () {
    yield* clientLog("debug", "[DeltaPull] executeDeltaPull loop checkpoint triggered.");

    if (!isOnlineState.value) {
      yield* clientLog("debug", "[DeltaPull] Device offline. Skipping pull cycle.");
      return;
    }

    const token = localStorage.getItem("jwt");
    yield* clientLog("debug", `[DeltaPull] Retrieved token from localStorage: "${token}"`);

    if (!token || token === "null" || token === "undefined" || token.trim() === "") {
      yield* clientLog("debug", "[DeltaPull] No valid active session found (token is falsy/empty/null/undefined). Skipping pull cycle.");
      return;
    }

    const lastPull = yield* Effect.tryPromise({
      try: () => getStoredPullTimestamp(),
      catch: (e) => e,
    });

    yield* clientLog("info", `[DeltaPull] Executing pull request (Since: ${lastPull})...`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`/api/sync/pull?since=${lastPull}`, {
          method: "GET",
          headers,
        }),
      catch: (e) => new Error(`Network failure during pull request: ${String(e)}`),
    });

    yield* clientLog("debug", `[DeltaPull] Pull request response status: ${response.status}`);

    if (!response.ok) {
      return yield* Effect.fail(new Error(`Server returned HTTP ${response.status}`));
    }

    const delta = (yield* Effect.tryPromise({
      try: () => response.json() as Promise<DeltaResponse>,
      catch: (e) => new Error(`Invalid JSON received from pull: ${String(e)}`),
    }));

    // Process and dispatch updates to local stores if payload contains updates
    if (delta.decks.length > 0 || delta.srsUpdates.length > 0) {
      yield* clientLog("info", `[DeltaPull] Applying updates: ${delta.decks.length} decks, ${delta.srsUpdates.length} SRS metrics.`);
      
      // Dynamic store imports to prevent circular dependencies
      const { deckStore } = yield* Effect.promise(() => import("../stores/deckStore"));
      const { srsStore } = yield* Effect.promise(() => import("../stores/srsStore"));

      if (delta.decks.length > 0) {
        yield* deckStore.putAll(delta.decks);
      }
      if (delta.srsUpdates.length > 0) {
        yield* srsStore.putAll(delta.srsUpdates);
      }
    }

    yield* Effect.tryPromise({
      try: () => savePullTimestamp(delta.serverTimestamp),
      catch: (e) => e,
    });

    yield* clientLog("debug", `[DeltaPull] Pull cycle complete. Next checkpoint: ${delta.serverTimestamp}`);
  });

export const startDeltaPullEngine = () => {
  const pullSchedule = Schedule.spaced("10 minutes");
  const pullLoop = Effect.gen(function* () {
    yield* executeDeltaPull();
  }).pipe(
    Effect.catchAll((err) =>
      clientLog("error", "[DeltaPull] Execution loop failed", err)
    ),
    Effect.repeat(pullSchedule)
  );

  runClientUnscoped(pullLoop);
};
