import { createStore, get, set } from "idb-keyval";
import { Effect } from "effect";
import { clientLog } from "../clientLog";

export const CURRENT_CLIENT_DB_VERSION = 2; // Version 2 introduces deterministic FSRS-Lite parameters

const metadataStore = createStore("bedrock-lang-sync-v1", "metadata");
const collectionsStore = createStore("bedrock-lang-storage-v1", "collections");
const VERSION_KEY = "client_db_version";

interface LegacyGrammarPointProgress {
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

    // Persist the upgraded version marker
    yield* Effect.tryPromise({
      try: () => set(VERSION_KEY, version, metadataStore),
      catch: (e) => new Error(`Failed to save upgraded client_db_version: ${String(e)}`),
    });

    yield* clientLog("info", `[ClientMigration] Local schema successfully upgraded to version ${version}.`);
  });
