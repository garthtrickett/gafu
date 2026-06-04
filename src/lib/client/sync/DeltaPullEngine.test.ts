import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeDeltaPull } from "./DeltaPullEngine";
import { Effect } from "effect";
import { deckStore } from "../stores/deckStore";
import { grammarPointStore, grammarPointCatalogStore } from "../stores/grammarPointStore";
import { userPreferencesStore } from "../stores/userPreferencesStore";
import { hlcStore, hlcSignal } from "../stores/hlcStore";
import { createStore, get, clear } from "idb-keyval";
import { unpackHlc } from "../../shared/hlc";

const syncMetadataStore = createStore("bedrock-lang-sync-v1", "metadata");

describe("DeltaPullEngine - Client Causal Merging", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.setItem("jwt", "mock-session-token");
    await clear(syncMetadataStore);
    await Effect.runPromise(deckStore.clear());
    await Effect.runPromise(grammarPointStore.clear());
    await Effect.runPromise(grammarPointCatalogStore.clear());
    await Effect.runPromise(userPreferencesStore.clear());
    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());
  });

  it("should safely integrate incoming server HLC timestamps and update the local clock", async () => {
    const serverFutureTime = Date.now() + 300000; // 5 minutes in future
    const serverHlc = `${serverFutureTime}:0002:server`;

    const mockPayload = {
      serverTimestamp: serverFutureTime,
      serverHlc: serverHlc,
      decks: [],
      srsUpdates: [],
      grammarPoints: []
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockPayload)
    });
    global.fetch = fetchMock as any;

    await Effect.runPromise(executeDeltaPull());

    // Verify that local client clock has been pulled up to the server's future physical time
    const currentHlc = hlcSignal.value;
    expect(currentHlc.physical).toBe(serverFutureTime);
    expect(currentHlc.counter).toBe(3); // serverHlc counter (2) + 1 (receiveHlc merge)

    // Verify that last_pull_hlc was persisted correctly
    const savedHlc = await get<string>("last_pull_hlc", syncMetadataStore);
    expect(savedHlc).toBe(serverHlc);
  });

  it("should discard older out-of-order changes from the server that are clobbered by newer local records", async () => {
    // 1. Setup a newer local record
    const localNewerHlc = `${Date.now()}:0005:client`;
    await Effect.runPromise(
      grammarPointStore.put({
        id: "gp-causal-test",
        easeFactor: 3.1,
        repetitions: 3,
        intervalDays: 14,
        nextReview: new Date().toISOString(),
        hlc: localNewerHlc
      })
    );

    // 2. Mock incoming server payload with an older HLC for the same record
    const serverOlderHlc = `${Date.now() - 60000}:0001:server`;
    const mockPayload = {
      serverTimestamp: Date.now(),
      serverHlc: `${Date.now()}:0001:server`,
      decks: [],
      srsUpdates: [
        {
          id: "srs-causal-test",
          grammarPointId: "gp-causal-test",
          easeFactor: 1.5, // older clobbered ease factor
          repetitions: 1,
          intervalDays: 1,
          nextReview: new Date().toISOString(),
          hlc: serverOlderHlc
        }
      ],
      grammarPoints: []
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockPayload)
    });
    global.fetch = fetchMock as any;

    await Effect.runPromise(executeDeltaPull());

    // Verify that the local store was NOT clobbered by the older server update
    const progress = grammarPointStore.state.peek().find(p => p.id === "gp-causal-test");
    expect(progress).toBeDefined();
    expect(progress!.easeFactor).toBe(3.1); // remains newer value
    expect(progress!.hlc).toBe(localNewerHlc);
  });

  it("should wipe local pull boundaries and re-trigger a full sync when the server returns a resetSync directive", async () => {
    // Seed initial last_pull_hlc and sync_epoch_id
    const oldHlc = `${Date.now() - 100000}:0001:server`;
    const { set } = await import("idb-keyval");
    await set("last_pull_hlc", oldHlc, syncMetadataStore);
        await set("sync_epoch_id", "old-epoch-uuid", syncMetadataStore);

    // Seed at least one deck and one catalog item to bypass self-healing full sync trigger
    await Effect.runPromise(
      deckStore.put({
        id: "mock-deck-id",
        name: "Mock Deck",
        category: "Japanese",
        content: {}
      })
    );
    await Effect.runPromise(
      grammarPointCatalogStore.put({
        id: "mock-catalog-id",
        formal_name: "Mock",
        base_meaning: "Meaning",
        difficulty_level: "N5"
      })
    );

    const newEpochId = "new-epoch-uuid";
    const resetPayload = {
      resetSync: true,
      epochId: newEpochId,
      serverTimestamp: Date.now(),
      serverHlc: `${Date.now()}:0000:server`,
      decks: [],
      srsUpdates: [],
      grammarPoints: []
    };

    const cleanSyncPayload = {
      serverTimestamp: Date.now() + 1000,
      serverHlc: `${Date.now() + 1000}:0001:server`,
      epochId: newEpochId,
      decks: [],
      srsUpdates: [],
      grammarPoints: []
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(resetPayload)
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(cleanSyncPayload)
      });
    global.fetch = fetchMock as any;

    await Effect.runPromise(executeDeltaPull());

    // Allow daemon fork re-trigger loop to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify 'last_pull_hlc' was wiped and then updated to the final HLC from the clean second pull
    const savedHlc = await get<string>("last_pull_hlc", syncMetadataStore);
    expect(savedHlc).toBe(cleanSyncPayload.serverHlc);

    // Verify the new server epochId was persisted under 'sync_epoch_id'
    const savedEpoch = await get<string>("sync_epoch_id", syncMetadataStore);
    expect(savedEpoch).toBe(newEpochId);

    // Verify fetch was invoked exactly twice, first with the old epoch/HLC and then with the reset 'initial' state
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`since=${oldHlc}&epochId=old-epoch-uuid`);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`since=0000000000000:0000:initial&epochId=${newEpochId}`);
  });
});
