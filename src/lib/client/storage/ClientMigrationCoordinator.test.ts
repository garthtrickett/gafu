import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { createStore, get, set, clear } from "idb-keyval";
import { runClientMigrations, CURRENT_CLIENT_DB_VERSION } from "./ClientMigrationCoordinator";

const metadataStore = createStore("bedrock-lang-sync-v1", "metadata");
const collectionsStore = createStore("bedrock-lang-storage-v1", "collections");

describe("ClientMigrationCoordinator - Offline Schema Transitions", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clear(metadataStore);
    await clear(collectionsStore);
  });

  it("should skip migrations and save the target schema version on a clean installation", async () => {
    // Simulate clean install (client_db_version is undefined, defaulting to version 1)
    await Effect.runPromise(runClientMigrations());

    const savedVersion = await get<number>("client_db_version", metadataStore);
    expect(savedVersion).toBe(CURRENT_CLIENT_DB_VERSION);
  });

  it("should sequentially migrate old SM-2 records to FSRS-Lite properties", async () => {
    // Seed v1 database version
    await set("client_db_version", 1, metadataStore);

    // Seed v1 format grammar point progress (missing difficulty, stability, and lastReviewedAt)
    const oldGpRecord = {
      id: "gp-migrate-1",
      easeFactor: 2.2,
      repetitions: 2,
      intervalDays: 8,
      nextReview: "2026-06-10T12:00:00.000Z",
    };

    // Seed v1 format SRS card (missing difficulty, stability, and lastReviewedAt)
    const oldSrsRecord = {
      id: "srs-migrate-1",
      easeFactor: 2.5,
      repetitions: 0,
      intervalDays: 0,
      nextReview: "2026-06-04T12:00:00.000Z",
    };

    await set("store:grammar_points", [oldGpRecord], collectionsStore);
    await set("store:srs", [oldSrsRecord], collectionsStore);

    // Run migration
    await Effect.runPromise(runClientMigrations());

    // Verify metadata version upgraded
    const savedVersion = await get<number>("client_db_version", metadataStore);
    expect(savedVersion).toBe(CURRENT_CLIENT_DB_VERSION);

    // Verify grammar point was correctly backfilled
    const migratedGps = await get<any[]>("store:grammar_points", collectionsStore);
    expect(migratedGps).toHaveLength(1);
    const gp = migratedGps![0];
    expect(gp.id).toBe("gp-migrate-1");
    expect(gp.difficulty).toBe(6.2); // calculated: 5.0 + (2.5 - 2.2) * 4 = 6.2
    expect(gp.stability).toBe(8);
    expect(gp.lastReviewedAt).toBe("2026-06-02T12:00:00.000Z"); // calculated: nextReview (10th) - 8 days = 2nd

    // Verify SRS card was correctly backfilled
    const migratedSrs = await get<any[]>("store:srs", collectionsStore);
    expect(migratedSrs).toHaveLength(1);
    const srs = migratedSrs![0];
    expect(srs.id).toBe("srs-migrate-1");
    expect(srs.difficulty).toBe(5.0); // calculated: 5.0 + (2.5 - 2.5) * 4 = 5.0
    expect(srs.stability).toBe(0);
    expect(srs.lastReviewedAt).toBeNull(); // repetitions = 0, so lastReviewedAt is null

    const sharedProgress = await get<any[]>("store:learner_progress", collectionsStore);
    expect(sharedProgress).toEqual([
      expect.objectContaining({ id: "gp-migrate-1", kind: "grammar", participationStatus: "active" }),
    ]);
  });

  it("migrates multiple user scopes and is safe to repeat after a partial write", async () => {
    await set("client_db_version", 2, metadataStore);
    await set("store:user-a:grammar_points", [{
      id: "point-a", easeFactor: 2.5, repetitions: 1, intervalDays: 1,
      nextReview: "2026-08-28T00:00:00.000Z",
    }], collectionsStore);
    await set("store:user-b:grammar_points", [{
      id: "point-b", easeFactor: 2.5, repetitions: 0, intervalDays: 0,
      nextReview: "2026-08-28T00:00:00.000Z",
    }], collectionsStore);
    await set("store:user-a:learner_progress", [{
      id: "partial", kind: "vocabulary", easeFactor: 2.5, repetitions: 0,
      intervalDays: 0, nextReview: "2026-08-28T00:00:00.000Z",
    }], collectionsStore);

    await Effect.runPromise(runClientMigrations());
    await set("client_db_version", 2, metadataStore);
    await Effect.runPromise(runClientMigrations());

    expect((await get<any[]>("store:user-a:learner_progress", collectionsStore))?.map((item) => item.id).sort())
      .toEqual(["partial", "point-a"]);
    expect((await get<any[]>("store:user-b:learner_progress", collectionsStore))?.map((item) => item.id))
      .toEqual(["point-b"]);
  });
});
