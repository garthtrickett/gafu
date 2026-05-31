import { createStore, get, set } from "idb-keyval";
import { Effect, Schedule } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const DB_NAME = "bedrock-lang-sync-v1";
const STORE_NAME = "metadata";
const syncMetadataStore = createStore(DB_NAME, STORE_NAME);
const LAST_PULL_KEY = "last_pull_hlc";

interface DeltaResponse {
  readonly serverTimestamp: number;
  readonly serverHlc: string;
  readonly decks: Array<{
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly content: unknown;
    readonly hlc: string;
  }>;
  readonly srsUpdates: Array<{
    readonly id: string;
    readonly grammarPointId: string;
    readonly easeFactor: number;
    readonly repetitions: number;
    readonly intervalDays: number;
    readonly nextReview: string;
    readonly hlc: string;
  }>;
  readonly grammarPoints: Array<{
    readonly id: string;
    readonly formal_name: string;
    readonly base_meaning: string;
    readonly difficulty_level: string;
    readonly hlc: string;
  }>;
    readonly userPreference?: {
    readonly dailyReviewLimit: number;
    readonly dailyNewRuleLimit: number;
    readonly enforceMasteryGates: boolean;
    readonly hlc: string;
  };
}

const getStoredPullHlc = (): Promise<string> => {
  return get<string>(LAST_PULL_KEY, syncMetadataStore).then((hlc) => hlc || "0000000000000:0000:initial");
};

const savePullHlc = (hlc: string): Promise<void> => {
  return set(LAST_PULL_KEY, hlc, syncMetadataStore);
};

const filterCausal = <T extends { id: string; hlc?: string }>(
  incoming: T[],
  existingList: readonly { id: string; hlc?: string }[]
): T[] => {
  return incoming.filter((inc) => {
    const ext = existingList.find((e) => e.id === inc.id);
    if (!ext || !ext.hlc || !inc.hlc) return true;
    return inc.hlc > ext.hlc;
  });
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
      yield* clientLog("debug", "[DeltaPull] No valid active session found. Skipping pull cycle.");
      return;
    }

    let lastPull = yield* Effect.tryPromise({
      try: () => getStoredPullHlc(),
      catch: (e) => e,
    });

    const { deckStore } = yield* Effect.promise(() => import("../stores/deckStore"));
    const { srsStore } = yield* Effect.promise(() => import("../stores/srsStore"));
    const { grammarPointStore, grammarPointCatalogStore } = yield* Effect.promise(() => import("../stores/grammarPointStore"));
    const { userPreferencesStore } = yield* Effect.promise(() => import("../stores/userPreferencesStore"));

    const deckCount = deckStore?.state?.peek()?.length ?? 0;
    const gpCount = grammarPointStore?.state?.peek()?.length ?? 0;
    const catalogCount = grammarPointCatalogStore?.state?.peek()?.length ?? 0;
    
    yield* clientLog("info", `[DeltaPull] Local state inspection - deckCount: ${deckCount}, gpCount: ${gpCount}, catalogCount: ${catalogCount}, lastPull: ${lastPull}`);
    
    if (lastPull !== "0000000000000:0000:initial" && deckCount === 0 && gpCount === 0 && catalogCount === 0) {
      yield* clientLog("warn", "[DeltaPull] Local stores are empty but lastPull is non-initial. Forcing full sync (since=initial) to heal from server reset.");
      lastPull = "0000000000000:0000:initial";
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
      `[DeltaPull] Received pull payload - Decks: ${decksLen}, SRS updates: ${srsUpdatesLen}, Grammar Points: ${gpLen}, serverHlc: ${delta?.serverHlc}`
    );

    if (decksLen > 0 || srsUpdatesLen > 0 || gpLen > 0 || delta.userPreference) {
      yield* clientLog("info", `[DeltaPull] Applying updates: ${decksLen} decks, ${srsUpdatesLen} SRS metrics, ${gpLen} catalog items.`);
      
      if (decksLen > 0 && deckStore) {
        const existingDecks = deckStore.state.peek();
        const filteredDecks = filterCausal(delta.decks, existingDecks);
        if (filteredDecks.length > 0) {
          yield* deckStore.putAll(filteredDecks);
        }
      }
      
      if (gpLen > 0 && grammarPointCatalogStore && delta.grammarPoints) {
        const existingCatalog = grammarPointCatalogStore.state.peek();
        const mappedGps = delta.grammarPoints.map(gp => ({
          id: gp.id,
          formal_name: gp.formal_name,
          base_meaning: gp.base_meaning,
          difficulty_level: gp.difficulty_level,
          hlc: gp.hlc
        }));
        const filteredGps = filterCausal(mappedGps, existingCatalog);
        if (filteredGps.length > 0) {
          yield* grammarPointCatalogStore.putAll(filteredGps);
        }
      }

      if (srsUpdatesLen > 0 && srsStore && grammarPointStore) {
        const existingSrs = srsStore.state.peek();
        const mappedSrs = delta.srsUpdates.map(u => ({
          id: u.id,
          front: "",
          back: "",
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview,
          hlc: u.hlc
        }));
        const filteredSrs = filterCausal(mappedSrs, existingSrs);
        if (filteredSrs.length > 0) {
          yield* srsStore.putAll(filteredSrs);
        }

        const existingProgress = grammarPointStore.state.peek();
        const mappedProgress = delta.srsUpdates.map(u => ({
          id: u.grammarPointId,
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview,
          hlc: u.hlc
        }));
        const filteredProgress = filterCausal(mappedProgress, existingProgress);
        if (filteredProgress.length > 0) {
          yield* grammarPointStore.putAll(filteredProgress);
        }
      }

            if (delta.userPreference && userPreferencesStore) {
        const existingPref = userPreferencesStore.state.peek().find(p => p.id === "settings");
        if (!existingPref || !existingPref.hlc || !delta.userPreference.hlc || delta.userPreference.hlc > existingPref.hlc) {
          yield* userPreferencesStore.put({
            id: "settings",
            dailyReviewLimit: delta.userPreference.dailyReviewLimit,
            dailyNewRuleLimit: delta.userPreference.dailyNewRuleLimit,
            enforceMasteryGates: delta.userPreference.enforceMasteryGates,
            hlc: delta.userPreference.hlc
          });
        }
      }
    }

    if (delta.serverHlc) {
      const { hlcStore } = yield* Effect.promise(() => import("../stores/hlcStore"));
      yield* hlcStore.updateWithRemote(delta.serverHlc);
    }

    yield* Effect.tryPromise({
      try: () => savePullHlc(delta?.serverHlc ?? lastPull),
      catch: (e) => e,
    });

    yield* clientLog("debug", `[DeltaPull] Pull cycle complete. Next checkpoint HLC: ${delta?.serverHlc ?? lastPull}`);
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
