import { createStore, del, get, keys, set } from "idb-keyval";
import { Effect } from "effect";
import { clientLog } from "../clientLog";
import { initHlc, packHlc, receiveHlc, tickHlc, type Hlc } from "../../shared/hlc.ts";

export const CURRENT_CLIENT_DB_VERSION = 4;

const metadataStore = createStore("bedrock-lang-sync-v1", "metadata");
const collectionsStore = createStore("bedrock-lang-storage-v1", "collections");
const VERSION_KEY = "client_db_version";
const HLC_STATE_KEY = "hlc_state";
const RECOVERY_PENDING_PREFIX = "progress_recovery_pending:";
const hlcStore = createStore("bedrock-lang-hlc-v1", "hlc_metadata");

interface LegacyGrammarPointProgress {
  id: string;
  easeFactor?: number;
  repetitions?: number;
  intervalDays?: number;
  nextReview: string | Date;
  difficulty?: number;
  stability?: number;
  lastReviewedAt?: string | null;
  kind?: "grammar" | "vocabulary";
  participationStatus?: "active" | "archived";
  learningState?: "introduced" | "primed" | "encountered" | "learning" | "stable" | "known";
  hlc?: string;
  [key: string]: unknown;
}

interface LegacySrsCardClient {
  id: string;
  easeFactor?: number;
  repetitions?: number;
  intervalDays?: number;
  nextReview: string | Date;
  difficulty?: number;
  stability?: number;
  lastReviewedAt?: string | null;
  [key: string]: unknown;
}

const migrateV1ToV2 = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[ClientMigration] Running V1 to V2 migration (FSRS-Lite parameters backfill)...");

    // 1. Backfill grammar_points collection
        const gpKey = "store:grammar_points";
    const rawGps = yield* Effect.tryPromise({
      try: () => get<LegacyGrammarPointProgress[]>(gpKey, collectionsStore),
      catch: (e) => new Error(`Failed to read grammar_points during migration: ${String(e)}`),
    });

        if (rawGps && rawGps.length > 0) {
      yield* clientLog("info", `[ClientMigration] Backfilling ${rawGps.length} grammar point progress records...`);
      const updatedGps = rawGps.map((item): LegacyGrammarPointProgress => {
        const ease = item.easeFactor ?? 2.5;
        const difficulty = item.difficulty !== undefined ? item.difficulty : Math.round(Math.max(1.0, Math.min(10.0, 5.0 + (2.5 - ease) * 4.0)) * 100) / 100;
        const stability = item.stability !== undefined ? item.stability : (item.intervalDays ?? 0.0);
        
                let lastReviewedAt = item.lastReviewedAt ?? null;
        if (!lastReviewedAt && ((item.repetitions ?? 0) > 0 || (item.intervalDays ?? 0) > 0)) {
          const nextDate = new Date(item.nextReview);
          nextDate.setDate(nextDate.getDate() - (item.intervalDays ?? 0));
          lastReviewedAt = nextDate.toISOString();
        }

        return {
          ...item,
          difficulty,
          stability,
          lastReviewedAt,
        };
      });

      yield* Effect.tryPromise({
        try: () => set(gpKey, updatedGps, collectionsStore),
        catch: (e) => new Error(`Failed to save migrated grammar_points: ${String(e)}`),
      });
    }

        // 2. Backfill srs cards collection
    const srsKey = "store:srs";
    const rawSrs = yield* Effect.tryPromise({
      try: () => get<LegacySrsCardClient[]>(srsKey, collectionsStore),
      catch: (e) => new Error(`Failed to read srs cards during migration: ${String(e)}`),
    });

        if (rawSrs && rawSrs.length > 0) {
      yield* clientLog("info", `[ClientMigration] Backfilling ${rawSrs.length} SRS card records...`);
      const updatedSrs = rawSrs.map((item): LegacySrsCardClient => {
        const ease = item.easeFactor ?? 2.5;
        const difficulty = item.difficulty !== undefined ? item.difficulty : Math.round(Math.max(1.0, Math.min(10.0, 5.0 + (2.5 - ease) * 4.0)) * 100) / 100;
        const stability = item.stability !== undefined ? item.stability : (item.intervalDays ?? 0.0);
        
                let lastReviewedAt = item.lastReviewedAt ?? null;
        if (!lastReviewedAt && ((item.repetitions ?? 0) > 0 || (item.intervalDays ?? 0) > 0)) {
          const nextDate = new Date(item.nextReview);
          nextDate.setDate(nextDate.getDate() - (item.intervalDays ?? 0));
          lastReviewedAt = nextDate.toISOString();
        }

        return {
          ...item,
          difficulty,
          stability,
          lastReviewedAt,
        };
      });

      yield* Effect.tryPromise({
        try: () => set(srsKey, updatedSrs, collectionsStore),
        catch: (e) => new Error(`Failed to save migrated srs cards: ${String(e)}`),
      });
    }

    yield* clientLog("info", "[ClientMigration] V1 to V2 migration completed successfully.");
  });

interface LegacyCatalogItem {
  readonly id: string;
  readonly formal_name: string;
  readonly base_meaning: string;
  readonly difficulty_level: string;
  readonly hlc?: string;
}

const destinationKey = (sourceKey: string, destinationCollection: string) => {
  const suffix = sourceKey.endsWith(":grammar_points")
    ? ":grammar_points"
    : ":grammar_point_catalog";
  return `${sourceKey.slice(0, -suffix.length)}:${destinationCollection}`;
};

const mergeById = <T extends { readonly id: string }>(existing: readonly T[], incoming: readonly T[]): T[] => {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
};

const migrateV2ToV3 = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[ClientMigration] Running V2 to V3 shared knowledge-point migration...");
    const collectionKeys = yield* Effect.tryPromise({
      try: () => keys(collectionsStore),
      catch: (e) => new Error(`Failed to enumerate local collections: ${String(e)}`),
    });

    const sourceKeys = collectionKeys.filter(
      (key): key is string => typeof key === "string" &&
        (key.endsWith(":grammar_points") || key.endsWith(":grammar_point_catalog")),
    );

    for (const sourceKey of sourceKeys) {
      if (sourceKey.endsWith(":grammar_points")) {
        const source = (yield* Effect.tryPromise({
          try: () => get<LegacyGrammarPointProgress[]>(sourceKey, collectionsStore),
          catch: (e) => new Error(`Failed to read ${sourceKey}: ${String(e)}`),
        })) ?? [];
        const targetKey = destinationKey(sourceKey, "learner_progress");
        const existing = (yield* Effect.tryPromise({
          try: () => get<Array<LegacyGrammarPointProgress & { kind: "grammar" }>>(targetKey, collectionsStore),
          catch: (e) => new Error(`Failed to read ${targetKey}: ${String(e)}`),
        })) ?? [];
        const migrated = source.map((item) => ({
          ...item,
          kind: "grammar" as const,
          participationStatus: "active" as const,
          learningState: (item.stability ?? 0) >= 21 ? "stable" as const : "learning" as const,
        }));
        yield* Effect.tryPromise({
          try: () => set(targetKey, mergeById(existing, migrated), collectionsStore),
          catch: (e) => new Error(`Failed to write ${targetKey}: ${String(e)}`),
        });
      } else {
        const source = (yield* Effect.tryPromise({
          try: () => get<LegacyCatalogItem[]>(sourceKey, collectionsStore),
          catch: (e) => new Error(`Failed to read ${sourceKey}: ${String(e)}`),
        })) ?? [];
        const targetKey = destinationKey(sourceKey, "knowledge_point_catalog");
        const existing = (yield* Effect.tryPromise({
          try: () => get<Array<LegacyCatalogItem & { kind: "grammar" }>>(targetKey, collectionsStore),
          catch: (e) => new Error(`Failed to read ${targetKey}: ${String(e)}`),
        })) ?? [];
        const migrated = source.map((item) => ({ ...item, kind: "grammar" as const }));
        yield* Effect.tryPromise({
          try: () => set(targetKey, mergeById(existing, migrated), collectionsStore),
          catch: (e) => new Error(`Failed to write ${targetKey}: ${String(e)}`),
        });
      }
    }

    yield* clientLog("info", `[ClientMigration] Migrated ${sourceKeys.length} user-scoped knowledge collections.`);
  });

const progressStrength = (item: LegacyGrammarPointProgress): readonly [number, number, number] => [
  item.stability ?? 0,
  item.repetitions ?? 0,
  item.intervalDays ?? 0,
];

const compareProgressStrength = (
  left: LegacyGrammarPointProgress,
  right: LegacyGrammarPointProgress,
): number => {
  const leftStrength = progressStrength(left);
  const rightStrength = progressStrength(right);
  for (let index = 0; index < leftStrength.length; index++) {
    const difference = (leftStrength[index] ?? 0) - (rightStrength[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const hasStudyHistory = (item: LegacyGrammarPointProgress): boolean =>
  (item.repetitions ?? 0) > 0 ||
  (item.stability ?? 0) > 0 ||
  (item.intervalDays ?? 0) > 0;

const scopedUserId = (sourceKey: string): string | null => {
  const match = /^store:([^:]+):grammar_points$/.exec(sourceKey);
  return match?.[1] ?? null;
};

const migrateV3ToV4 = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[ClientMigration] Running V3 to V4 learner-progress recovery migration...");
    const collectionKeys = yield* Effect.tryPromise({
      try: () => keys(collectionsStore),
      catch: (e) => new Error(`Failed to enumerate legacy progress collections during recovery: ${String(e)}`),
    });
    const sourceKeys = collectionKeys.filter(
      (key): key is string => typeof key === "string" && key.endsWith(":grammar_points"),
    );
    let recoveryClock = (yield* Effect.tryPromise({
      try: () => get<Hlc>(HLC_STATE_KEY, hlcStore),
      catch: (e) => new Error(`Failed to load the client clock during progress recovery: ${String(e)}`),
    })) ?? initHlc(`progress-recovery-${crypto.randomUUID()}`, Date.now());
    let recoveredCount = 0;

    for (const sourceKey of sourceKeys) {
      const source = (yield* Effect.tryPromise({
        try: () => get<LegacyGrammarPointProgress[]>(sourceKey, collectionsStore),
        catch: (e) => new Error(`Failed to read legacy progress ${sourceKey}: ${String(e)}`),
      })) ?? [];
      const targetKey = destinationKey(sourceKey, "learner_progress");
      const existing = (yield* Effect.tryPromise({
        try: () => get<Array<LegacyGrammarPointProgress & { kind?: "grammar" | "vocabulary" }>>(targetKey, collectionsStore),
        catch: (e) => new Error(`Failed to read shared progress ${targetKey}: ${String(e)}`),
      })) ?? [];
      const merged = new Map(existing.map((item) => [item.id, item]));
      const recoveredIds: string[] = [];

      for (const legacy of source) {
        if (!hasStudyHistory(legacy)) continue;
        const current = merged.get(legacy.id);
        const legacyIsStronger = !current || compareProgressStrength(legacy, current) > 0;
        const currentNeedsCausalStamp = Boolean(current && !current.hlc);
        if (!legacyIsStronger && !currentNeedsCausalStamp) continue;

        const strongest = legacyIsStronger ? legacy : current;
        if (legacy.hlc) recoveryClock = receiveHlc(recoveryClock, legacy.hlc, Date.now());
        if (current?.hlc) recoveryClock = receiveHlc(recoveryClock, current.hlc, Date.now());
        recoveryClock = tickHlc(recoveryClock, Date.now());
        const recoveredHlc = packHlc(recoveryClock);
        const currentLearningState = current?.learningState;
        const recoveredStability = strongest?.stability ?? 0;
        merged.set(legacy.id, {
          ...current,
          ...strongest,
          kind: "grammar",
          participationStatus: current?.participationStatus ?? "active",
          learningState: currentLearningState === "known"
            ? "known"
            : recoveredStability >= 21
              ? "stable"
              : "learning",
          hlc: recoveredHlc,
        });
        recoveredIds.push(legacy.id);
        recoveredCount++;
      }

      if (recoveredIds.length === 0) {
        yield* clientLog("debug", `[ClientMigration] No stronger legacy study history found for ${sourceKey}.`);
        continue;
      }

      yield* Effect.tryPromise({
        try: () => set(targetKey, [...merged.values()], collectionsStore),
        catch: (e) => new Error(`Failed to save recovered progress ${targetKey}: ${String(e)}`),
      });
      const userId = scopedUserId(sourceKey);
      if (userId) {
        yield* Effect.tryPromise({
          try: () => set(`${RECOVERY_PENDING_PREFIX}${userId}`, recoveredIds, metadataStore),
          catch: (e) => new Error(`Failed to stage recovered progress for server repair: ${String(e)}`),
        });
        yield* clientLog("info", `[ClientMigration] Recovered ${recoveredIds.length} study records for user=${userId}; server repair is staged for authenticated startup.`);
      } else {
        yield* clientLog("warn", `[ClientMigration] Recovered ${recoveredIds.length} unscoped study records locally; no authenticated server repair can be staged.`);
      }
    }

    yield* Effect.tryPromise({
      try: () => set(HLC_STATE_KEY, recoveryClock, hlcStore),
      catch: (e) => new Error(`Failed to save the recovery client clock: ${String(e)}`),
    });
    yield* clientLog("info", `[ClientMigration] V3 to V4 recovery completed; recovered=${recoveredCount}, legacyCollections=${sourceKeys.length}.`);
  });

export const enqueuePendingProgressRecovery = (userId: string) =>
  Effect.gen(function* () {
    const pendingKey = `${RECOVERY_PENDING_PREFIX}${userId}`;
    const recoveredIds = (yield* Effect.tryPromise({
      try: () => get<string[]>(pendingKey, metadataStore),
      catch: (e) => new Error(`Failed to load staged progress recovery for user=${userId}: ${String(e)}`),
    })) ?? [];
    if (recoveredIds.length === 0) {
      yield* clientLog("debug", `[ClientMigration] No staged server progress recovery exists for user=${userId}.`);
      return;
    }

    const { knowledgePointStore } = yield* Effect.promise(() => import("../stores/knowledgePointStore.ts"));
    const { enqueueTransaction } = yield* Effect.promise(() => import("../sync/OutboxQueue.ts"));
    const recoveredIdSet = new Set(recoveredIds);
    const recoveredProgress = knowledgePointStore.state.peek().filter((item) => recoveredIdSet.has(item.id));
    yield* clientLog("info", `[ClientMigration] Queueing ${recoveredProgress.length} recovered study records for authenticated server repair.`);

    for (const progress of recoveredProgress) {
      const transactionHlc = yield* enqueueTransaction("record_review", {
        knowledgePointId: progress.id,
        easeFactor: progress.easeFactor,
        repetitions: progress.repetitions,
        intervalDays: progress.intervalDays,
        nextReview: progress.nextReview,
        difficulty: progress.difficulty ?? 5,
        stability: progress.stability ?? 0,
        lastReviewedAt: progress.lastReviewedAt ?? null,
      });
      yield* knowledgePointStore.put({ ...progress, hlc: transactionHlc });
    }

    yield* Effect.tryPromise({
      try: () => del(pendingKey, metadataStore),
      catch: (e) => new Error(`Failed to clear staged progress recovery for user=${userId}: ${String(e)}`),
    });
    yield* clientLog("info", `[ClientMigration] Queued and causally stamped ${recoveredProgress.length} recovered study records for server repair.`);
  });

export const runClientMigrations = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[ClientMigration] Checking local database schema version...");

    const storedVersion = yield* Effect.tryPromise({
      try: () => get<number>(VERSION_KEY, metadataStore).then((v) => v || 1),
      catch: (e) => new Error(`Failed to read client_db_version: ${String(e)}`),
    });

    yield* clientLog("debug", `[ClientMigration] Stored version: ${storedVersion}, Target version: ${CURRENT_CLIENT_DB_VERSION}`);

    if (storedVersion >= CURRENT_CLIENT_DB_VERSION) {
      yield* clientLog("info", "[ClientMigration] Local database schema is already up to date.");
      return;
    }

    let version = storedVersion;

    if (version < 2) {
      yield* migrateV1ToV2();
      version = 2;
    }

    if (version < 3) {
      yield* migrateV2ToV3();
      version = 3;
    }

    if (version < 4) {
      yield* migrateV3ToV4();
      version = 4;
    }

    // Persist the upgraded version marker
    yield* Effect.tryPromise({
      try: () => set(VERSION_KEY, version, metadataStore),
      catch: (e) => new Error(`Failed to save upgraded client_db_version: ${String(e)}`),
    });

    yield* clientLog("info", `[ClientMigration] Local schema successfully upgraded to version ${version}.`);
  });
