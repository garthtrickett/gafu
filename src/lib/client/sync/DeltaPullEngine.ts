import { createStore, get, set, del } from "idb-keyval";
import { Effect, Schedule } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const DB_NAME = "bedrock-lang-sync-v1";
const STORE_NAME = "metadata";
const syncMetadataStore = createStore(DB_NAME, STORE_NAME);
const LAST_PULL_KEY = "last_pull_hlc";
const SYNC_EPOCH_KEY = "sync_epoch_id";

interface DeltaResponse {
  readonly resetSync?: boolean;
  readonly epochId?: string;
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
    readonly knowledgePointId: string;
    readonly easeFactor: number;
    readonly repetitions: number;
    readonly intervalDays: number;
    readonly nextReview: string;
    readonly difficulty: number;
    readonly stability: number;
    readonly lastReviewedAt: string | null;
    readonly participationStatus: "active" | "archived";
    readonly learningState: "introduced" | "primed" | "encountered" | "learning" | "stable" | "known";
    readonly introducedAt: string | null;
    readonly checkoutDue?: boolean;
    readonly hlc: string;
  }>;
  readonly grammarPoints: Array<{
    readonly id: string;
    readonly formal_name: string;
    readonly base_meaning: string;
    readonly difficulty_level: string;
    readonly hlc: string;
  }>;
  readonly knowledgePoints: Array<{
    readonly id: string;
    readonly kind: "grammar" | "vocabulary";
    readonly canonical_key: string;
    readonly scope: "curated" | "personal";
    readonly catalogue_status: "active" | "archived" | "quarantined";
    readonly formal_name: string | null;
    readonly base_meaning: string | null;
    readonly difficulty_level: string | null;
    readonly lemma: string | null;
    readonly reading: string | null;
    readonly part_of_speech: string | null;
    readonly sense_key: string | null;
    readonly meaning: string | null;
    readonly register: string | null;
    readonly hlc: string;
  }>;
  readonly mediaCandidatePreferences?: Array<{
    readonly kind: "grammar" | "vocabulary";
    readonly canonicalKey: string;
    readonly disposition: "not_useful";
    readonly hlc: string;
  }>;
  readonly userPreference?: {
    readonly dailyReviewLimit: number;
    readonly dailyNewRuleLimit: number;
    readonly enforceMasteryGates: boolean;
    readonly learnerTimeZone: string;
    readonly hlc: string;
  };
}

const getStoredPullHlc = (): Promise<string> => {
  return get<string>(LAST_PULL_KEY, syncMetadataStore).then((hlc) => hlc || "0000000000000:0000:initial");
};

const savePullHlc = (hlc: string): Promise<void> => {
  return set(LAST_PULL_KEY, hlc, syncMetadataStore);
};

const clearStoredPullHlc = (): Promise<void> => {
  return del(LAST_PULL_KEY, syncMetadataStore);
};

const getStoredEpochId = (): Promise<string> => {
  return get<string>(SYNC_EPOCH_KEY, syncMetadataStore).then((id) => id || "");
};

const saveEpochId = (id: string): Promise<void> => {
  return set(SYNC_EPOCH_KEY, id, syncMetadataStore);
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

export const executeDeltaPull = (): Effect.Effect<void, unknown, never> =>
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

    const cachedEpochId = yield* Effect.tryPromise({
      try: () => getStoredEpochId(),
      catch: (e) => e,
    });

    const { deckStore } = yield* Effect.promise(() => import("../stores/deckStore"));
    const { srsStore } = yield* Effect.promise(() => import("../stores/srsStore"));
    const { knowledgePointStore, knowledgePointCatalogStore } = yield* Effect.promise(() => import("../stores/knowledgePointStore"));
    const { userPreferencesStore } = yield* Effect.promise(() => import("../stores/userPreferencesStore"));
    const { mediaCandidatePreferenceStore } = yield* Effect.promise(() => import("../stores/mediaCandidatePreferenceStore.ts"));

    const deckCount = deckStore?.state?.peek()?.length ?? 0;
    const gpCount = knowledgePointStore?.state?.peek()?.length ?? 0;
    const catalogCount = knowledgePointCatalogStore?.state?.peek()?.length ?? 0;
    
    yield* clientLog("info", `[DeltaPull] Local state inspection - deckCount: ${deckCount}, gpCount: ${gpCount}, catalogCount: ${catalogCount}, lastPull: ${lastPull}, cachedEpochId: ${cachedEpochId}`);
    
    if (lastPull !== "0000000000000:0000:initial" && (deckCount === 0 || catalogCount === 0)) {
      yield* clientLog("warn", "[DeltaPull] Local catalog or decks are empty but lastPull is non-initial. Forcing full sync (since=initial) to heal local state.");
      lastPull = "0000000000000:0000:initial";
    }

    yield* clientLog("info", `[DeltaPull] Executing pull request (Since: ${lastPull}, Epoch: ${cachedEpochId})...`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`/api/sync/pull?since=${lastPull}&epochId=${cachedEpochId}`, {
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

    // Causal Reset Handler: If database era mismatch occurs, client purges its boundary checkpoint
    if (delta.resetSync) {
      yield* clientLog("warn", `[DeltaPull] Sync Reset Requested by Server! Wiping last_pull_hlc and saving new epochId: ${delta.epochId}`);
      
      yield* Effect.tryPromise({
        try: () => clearStoredPullHlc(),
        catch: (e) => e,
      });

      if (delta.epochId) {
        yield* Effect.tryPromise({
          try: () => saveEpochId(delta.epochId!),
          catch: (e) => e,
        });
      }

      yield* clientLog("info", "[DeltaPull] Re-triggering executeDeltaPull for clean state pull...");
      yield* Effect.forkDaemon(executeDeltaPull());
      return;
    }

    // Persist new epoch ID if returned in standard response
    if (delta.epochId && delta.epochId !== cachedEpochId) {
      yield* Effect.tryPromise({
        try: () => saveEpochId(delta.epochId!),
        catch: (e) => e,
      });
    }

    const decksLen = delta?.decks?.length ?? 0;
    const srsUpdatesLen = delta?.srsUpdates?.length ?? 0;
    const gpLen = delta?.grammarPoints?.length ?? 0;
    const knowledgePointLen = delta?.knowledgePoints?.length ?? 0;
    const mediaPreferenceLen = delta?.mediaCandidatePreferences?.length ?? 0;

    yield* clientLog(
      "info",
      `[DeltaPull] Received pull payload - Decks: ${decksLen}, SRS updates: ${srsUpdatesLen}, Knowledge Points: ${knowledgePointLen}, Media Preferences: ${mediaPreferenceLen}, serverHlc: ${delta?.serverHlc}`
    );

    if (decksLen > 0 || srsUpdatesLen > 0 || knowledgePointLen > 0 || mediaPreferenceLen > 0 || delta.userPreference) {
      yield* clientLog("info", `[DeltaPull] Applying updates: ${decksLen} decks, ${srsUpdatesLen} SRS metrics, ${knowledgePointLen} catalog items, ${mediaPreferenceLen} media preferences.`);
      
      if (decksLen > 0 && deckStore) {
        const existingDecks = deckStore.state.peek();
        const filteredDecks = filterCausal(delta.decks, existingDecks);
        if (filteredDecks.length > 0) {
          yield* deckStore.putAll(filteredDecks);
        }
      }
      
      if (knowledgePointLen > 0 && knowledgePointCatalogStore) {
        const existingCatalog = knowledgePointCatalogStore.state.peek();
        const mappedGps = delta.knowledgePoints.map(point => point.kind === "grammar" ? ({
          id: point.id,
          kind: "grammar" as const,
          formal_name: point.formal_name ?? "",
          base_meaning: point.base_meaning ?? "",
          difficulty_level: point.difficulty_level ?? "",
          hlc: point.hlc
        }) : ({
          id: point.id,
          kind: "vocabulary" as const,
          canonical_key: point.canonical_key,
          scope: point.scope,
          catalogue_status: point.catalogue_status,
          lemma: point.lemma ?? "",
          reading: point.reading ?? "",
          part_of_speech: point.part_of_speech ?? "",
          sense_key: point.sense_key ?? "",
          meaning: point.meaning ?? "",
          register: point.register,
          hlc: point.hlc,
        }));
        const filteredGps = filterCausal(mappedGps, existingCatalog);
        if (filteredGps.length > 0) {
          yield* knowledgePointCatalogStore.putAll(filteredGps);
        }
      }

      if (srsUpdatesLen > 0 && srsStore && knowledgePointStore) {
        const existingSrs = srsStore.state.peek();
        const mappedSrs = delta.srsUpdates.map(u => ({ 
          id: u.id,
          knowledgePointId: u.knowledgePointId,
          front: "",
          back: "",
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview,
          difficulty: u.difficulty,
          stability: u.stability,
          lastReviewedAt: u.lastReviewedAt,
          checkoutDue: u.checkoutDue ?? false,
          hlc: u.hlc
        }));
        const filteredSrs = filterCausal(mappedSrs, existingSrs);
        if (filteredSrs.length > 0) {
          yield* srsStore.putAll(filteredSrs);
        }

        const existingProgress = knowledgePointStore.state.peek();
        const mappedProgress = delta.srsUpdates.map(u => ({ 
          id: u.knowledgePointId,
          participationStatus: u.participationStatus,
          learningState: u.learningState,
          easeFactor: u.easeFactor,
          repetitions: u.repetitions,
          intervalDays: u.intervalDays,
          nextReview: u.nextReview,
          difficulty: u.difficulty,
          stability: u.stability,
          lastReviewedAt: u.lastReviewedAt,
          unlockedAt: u.introducedAt ?? undefined,
          checkoutDue: u.checkoutDue ?? false,
          hlc: u.hlc
        }));
        const filteredProgress = filterCausal(mappedProgress, existingProgress);
        if (filteredProgress.length > 0) {
          yield* knowledgePointStore.putAll(filteredProgress);
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
            learnerTimeZone: delta.userPreference.learnerTimeZone,
            hlc: delta.userPreference.hlc
          });
        }
      }

      if (mediaPreferenceLen > 0) {
        const existingPreferences = mediaCandidatePreferenceStore.state.peek();
        const mappedPreferences = (delta.mediaCandidatePreferences ?? []).map((preference) => ({
          id: preference.canonicalKey,
          kind: preference.kind,
          canonicalKey: preference.canonicalKey,
          disposition: preference.disposition,
          hlc: preference.hlc,
        }));
        const filteredPreferences = filterCausal(mappedPreferences, existingPreferences);
        if (filteredPreferences.length > 0) {
          yield* mediaCandidatePreferenceStore.putAll(filteredPreferences);
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
