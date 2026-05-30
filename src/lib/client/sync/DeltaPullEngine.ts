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
  readonly decks: Array<{
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly content: unknown;
  }>;
  readonly srsUpdates: Array<{
    readonly id: string;
    readonly grammarPointId: string;
    readonly easeFactor: number;
    readonly repetitions: number;
    readonly intervalDays: number;
    readonly nextReview: string;
  }>;
  readonly grammarPoints: Array<{
    readonly id: string;
    readonly formal_name: string;
    readonly base_meaning: string;
    readonly difficulty_level: string;
  }>;
}

const getStoredPullTimestamp = (): Promise<number> => {
  return get<number>(LAST_PULL_KEY, syncMetadataStore).then((ts) => ts || 0);
};

const savePullTimestamp = (ts: number): Promise<void> => {
  return set(LAST_PULL_KEY, ts, syncMetadataStore);
};

export const executeDeltaPull = () =>
  Effect.gen(function* () {
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

    let lastPull = yield* Effect.tryPromise({
      try: () => getStoredPullTimestamp(),
      catch: (e) => e,
    });

    // Dynamic store imports to prevent circular dependencies
    const { deckStore } = yield* Effect.promise(() => import("../stores/deckStore"));
    const { srsStore } = yield* Effect.promise(() => import("../stores/srsStore"));
    const { grammarPointStore, grammarPointCatalogStore } = yield* Effect.promise(() => import("../stores/grammarPointStore"));

        // Self-healing: If our local stores are completely empty but we have a non-zero lastPull timestamp,
    // it's highly likely the server database was wiped/reset. Let's force a full sync (since=0).
    const deckCount = deckStore?.state?.peek()?.length ?? 0;
    const gpCount = grammarPointStore?.state?.peek()?.length ?? 0;
    const catalogCount = grammarPointCatalogStore?.state?.peek()?.length ?? 0;
    
    yield* clientLog("info", `[DeltaPull] Local state inspection - deckCount: ${deckCount}, gpCount: ${gpCount}, catalogCount: ${catalogCount}, lastPull: ${lastPull}`);
    
    if (lastPull > 0 && deckCount === 0 && gpCount === 0 && catalogCount === 0) {
      yield* clientLog("warn", "[DeltaPull] Local stores are empty but lastPull is non-zero. Forcing full sync (since=0) to heal from server reset.");
      lastPull = 0;
    }

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

    const decksLen = delta?.decks?.length ?? 0;
    const srsUpdatesLen = delta?.srsUpdates?.length ?? 0;
    const gpLen = delta?.grammarPoints?.length ?? 0;

    yield* clientLog(
      "info",
      `[DeltaPull] Received pull payload - Decks: ${decksLen}, SRS updates: ${srsUpdatesLen}, Grammar Points: ${gpLen}, serverTimestamp: ${delta?.serverTimestamp}`
    );

    // Process and dispatch updates to local stores if payload contains updates
    if (decksLen > 0 || srsUpdatesLen > 0 || gpLen > 0) {
      yield* clientLog("info", `[DeltaPull] Applying updates: ${decksLen} decks, ${srsUpdatesLen} SRS metrics, ${gpLen} catalog items.`);
      
      if (decksLen > 0 && deckStore) {
        yield* deckStore.putAll(delta.decks);
      }
      
      if (gpLen > 0 && grammarPointCatalogStore && delta.grammarPoints) {
        yield* grammarPointCatalogStore.putAll(delta.grammarPoints.map(gp => ({
          id: gp.id,
          formal_name: gp.formal_name,
          base_meaning: gp.base_meaning,
          difficulty_level: gp.difficulty_level
        })));
      }

      if (srsUpdatesLen > 0 && srsStore && grammarPointStore) {
        // Hydrate srsStore
        yield* srsStore.putAll(delta.srsUpdates.map(u => ({
          id: u.id,
          front: "",
          back: "",
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview
        })));

        // Hydrate grammarPointStore mapped by grammarPointId
        yield* grammarPointStore.putAll(delta.srsUpdates.map(u => ({
          id: u.grammarPointId,
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview
        })));
      }
    }

        yield* Effect.tryPromise({
      try: () => savePullTimestamp(delta?.serverTimestamp ?? Date.now()),
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
