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
});
