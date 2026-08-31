import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { createStore, get, set, clear } from "idb-keyval";
import { runClientMigrations, enqueuePendingProgressRecovery, CURRENT_CLIENT_DB_VERSION } from "./ClientMigrationCoordinator";
import { userState } from "../stores/authStore.ts";
import { knowledgePointStore } from "../stores/knowledgePointStore.ts";
import { hlcStore as clientHlcStore } from "../stores/hlcStore.ts";

const metadataStore = createStore("bedrock-lang-sync-v1", "metadata");
const collectionsStore = createStore("bedrock-lang-storage-v1", "collections");
const hlcMetadataStore = createStore("bedrock-lang-hlc-v1", "hlc_metadata");
const outboxStore = createStore("bedrock-lang-outbox-v1", "outbox");

describe("ClientMigrationCoordinator - Offline Schema Transitions", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clear(metadataStore);
    await clear(collectionsStore);
    await clear(hlcMetadataStore);
    await clear(outboxStore);
    userState.value = null;
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

  it("recovers stronger legacy study history and stages it for authenticated server repair", async () => {
    const userId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const pointId = "bfeebc99-9c0b-4ef8-bb6d-6bb9bd389bbf";
    await set("client_db_version", 3, metadataStore);
    await set(`store:${userId}:grammar_points`, [{
      id: pointId,
      easeFactor: 2.7,
      repetitions: 8,
      intervalDays: 30,
      nextReview: "2026-09-30T00:00:00.000Z",
      difficulty: 3,
      stability: 30,
      lastReviewedAt: "2026-08-31T00:00:00.000Z",
    }], collectionsStore);
    await set(`store:${userId}:learner_progress`, [{
      id: pointId,
      kind: "grammar",
      participationStatus: "active",
      learningState: "introduced",
      easeFactor: 2.5,
      repetitions: 0,
      intervalDays: 0,
      nextReview: "2026-08-31T00:00:00.000Z",
      difficulty: 5,
      stability: 0,
      lastReviewedAt: null,
      checkoutDue: false,
      hlc: "9999999999999:0000:server-reset",
    }], collectionsStore);

    await Effect.runPromise(runClientMigrations());

    const recovered = await get<any[]>(`store:${userId}:learner_progress`, collectionsStore);
    expect(recovered).toEqual([
      expect.objectContaining({
        id: pointId,
        repetitions: 8,
        intervalDays: 30,
        stability: 30,
        learningState: "stable",
        checkoutDue: false,
      }),
    ]);
    expect(recovered?.[0]?.hlc > "9999999999999:0000:server-reset").toBe(true);
    expect(await get<string[]>(`progress_recovery_pending:${userId}`, metadataStore)).toEqual([pointId]);
    expect(await get<number>("client_db_version", metadataStore)).toBe(4);

    userState.value = { id: userId, email: "learner@site.com", permissions: [] };
    await Effect.runPromise(clientHlcStore.load());
    await Effect.runPromise(knowledgePointStore.load());
    await Effect.runPromise(enqueuePendingProgressRecovery(userId));

    expect(await get<string[]>(`progress_recovery_pending:${userId}`, metadataStore)).toBeUndefined();
    const pendingTransactions = await get<string[]>("outbox_pending_keys", outboxStore);
    expect(pendingTransactions).toHaveLength(1);
    const transaction = await get<{ hlc: string; payload: { knowledgePointId: string; repetitions: number } }>(
      `tx:${pendingTransactions?.[0]}`,
      outboxStore,
    );
    expect(transaction?.payload).toEqual(expect.objectContaining({ knowledgePointId: pointId, repetitions: 8 }));
    expect(knowledgePointStore.state.peek()[0]?.hlc).toBe(transaction?.hlc);
  });
});
