import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeDeltaPull } from "./DeltaPullEngine";
import { Effect } from "effect";
import { deckStore } from "../stores/deckStore";
import { grammarPointStore, grammarPointCatalogStore } from "../stores/grammarPointStore";
import { userPreferencesStore } from "../stores/userPreferencesStore";
import { hlcStore, hlcSignal } from "../stores/hlcStore";
import { createStore, get, clear } from "idb-keyval";
import { unpackHlc } from "../../shared/hlc";
import { mediaCandidatePreferenceStore } from "../stores/mediaCandidatePreferenceStore.ts";

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
    await Effect.runPromise(mediaCandidatePreferenceStore.clear());
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

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/log")) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayload)
      });
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

  it("hydrates synced canonical media preferences for future episode filtering", async () => {
    const serverHlc = `${Date.now()}:0002:server`;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/log")) return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          serverTimestamp: Date.now(),
          serverHlc,
          decks: [],
          srsUpdates: [],
          grammarPoints: [],
          knowledgePoints: [],
          mediaCandidatePreferences: [{
            kind: "vocabulary",
            canonicalKey: "vocabulary:猫:ねこ:名詞",
            disposition: "not_useful",
            hlc: serverHlc,
          }],
        }),
      });
    });
    global.fetch = fetchMock as never;

    await Effect.runPromise(executeDeltaPull());

    expect(mediaCandidatePreferenceStore.state.peek()).toEqual([{
      id: "vocabulary:猫:ねこ:名詞",
      kind: "vocabulary",
      canonicalKey: "vocabulary:猫:ねこ:名詞",
      disposition: "not_useful",
      hlc: serverHlc,
    }]);
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
          knowledgePointId: "gp-causal-test",
          easeFactor: 1.5, // older clobbered ease factor
          repetitions: 1,
          intervalDays: 1,
          nextReview: new Date().toISOString(),
          hlc: serverOlderHlc
        }
      ],
      grammarPoints: []
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/log")) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayload)
      });
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

    let pullCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/log")) {
        return Promise.resolve({ ok: true });
      }
      if (url.includes("/api/sync/pull")) {
        pullCallCount++;
        const payload = pullCallCount === 1 ? resetPayload : cleanSyncPayload;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(payload)
        });
      }
      return Promise.resolve({ ok: true });
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

    // Filter fetchMock calls specifically to the sync/pull endpoint to prevent background log pollution
    const syncPullCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/api/sync/pull"));
    expect(syncPullCalls.length).toBe(2);
    expect(syncPullCalls[0]?.[0]).toContain(`since=${oldHlc}&epochId=old-epoch-uuid`);
    expect(syncPullCalls[1]?.[0]).toContain(`since=0000000000000:0000:initial&epochId=${newEpochId}`);
  });

  it("should prevent older server reviews from overwriting newer local modifications made during study session", async () => {
    const currentHlc = await Effect.runPromise(hlcStore.tick());
    await Effect.runPromise(
      grammarPointStore.put({
        id: "gp-causal-bug-test",
        easeFactor: 2.8,
        repetitions: 3,
        intervalDays: 21,
        nextReview: new Date().toISOString(),
        difficulty: 3.0,
        stability: 21.0,
        lastReviewedAt: new Date().toISOString(),
        hlc: currentHlc
      })
    );

    const olderServerHlc = `${Date.now() - 60000}:0001:server`;
    const mockPayload = {
      serverTimestamp: Date.now(),
      serverHlc: `${Date.now()}:0001:server`,
      decks: [],
      srsUpdates: [
        {
          id: "srs-causal-bug-test",
          knowledgePointId: "gp-causal-bug-test",
          easeFactor: 2.5,
          repetitions: 1,
          intervalDays: 1,
          nextReview: new Date().toISOString(),
          difficulty: 5.0,
          stability: 1.0,
          lastReviewedAt: new Date().toISOString(),
          hlc: olderServerHlc
        }
      ],
      grammarPoints: []
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/log")) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayload)
      });
    });
    global.fetch = fetchMock as any;

    await Effect.runPromise(executeDeltaPull());

    const progress = grammarPointStore.state.peek().find(p => p.id === "gp-causal-bug-test");
    expect(progress).toBeDefined();
    expect(progress!.repetitions).toBe(3);
  });
});
