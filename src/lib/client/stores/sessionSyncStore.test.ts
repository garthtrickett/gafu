import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import { get, createStore } from "idb-keyval";
import { generateExportPayload, importSessionPayload } from "./sessionSyncStore";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore";
import { activeSessionStore } from "./activeSessionStore";

const outboxStore = createStore("bedrock-lang-outbox-v1", "outbox");

describe("sessionSyncStore - Export & Import Handshake", () => {
  beforeEach(async () => {
    await Effect.runPromise(grammarPointStore.clear());
    await Effect.runPromise(grammarPointCatalogStore.clear());
    activeSessionStore.clear();
  });

  it("should dynamically append the next 5 unstudied rules if the active study list size is under 15", async () => {
    // Seed a mock catalog of 20 items
    const mockCatalog = Array.from({ length: 20 }, (_, i) => ({
      id: `gp-id-${i}`,
      formal_name: `Point ${i}`,
      base_meaning: `Meaning ${i}`,
      difficulty_level: 'N5'
    }));
    await Effect.runPromise(grammarPointCatalogStore.putAll(mockCatalog));

    // Setup only 5 studied rules (below our threshold of 15)
    const mockProgress = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-id-${i}`, // matches first 5 catalog IDs
      easeFactor: 2.5,
      repetitions: 3,
      intervalDays: 6,
      nextReview: new Date().toISOString()
    }));
    await Effect.runPromise(grammarPointStore.putAll(mockProgress));

    // Generate the payload
    const rawPayload = await Effect.runPromise(generateExportPayload());
    const payload = JSON.parse(rawPayload);

    // The resulting queue should contain:
    // - The 5 already studied items
    // - Plus the next 5 unstudied items (gp-id-5 to gp-id-9) appended as introductions
    expect(payload.queue).toHaveLength(10);

    // Verify that gp-id-5 was successfully added with 0 repetitions
    const introducedItem = payload.queue.find((q: any) => q.grammar_point_id === 'gp-id-5');
    expect(introducedItem).toBeDefined();
    expect(introducedItem.repetitions).toBe(0);
    expect(introducedItem.ease_factor).toBe(2.5);
  });

  it("should initialize progress records and enqueue outbox sync transactions for unrecognized imported grammar points", async () => {
    // Mock an imported payload introducing a completely unrecognized rule 'gp-new-99'
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "gp-new-99",
          english_context: "New introduction context",
          japanese_sentence: "New introduction sentence",
          furigana: []
        }
      ]
    };

    const jsonString = JSON.stringify(mockPayload);

    // Verify that gp-new-99 is unrecognized in our local progress store before import
    const initialProgress = grammarPointStore.state.peek().find(p => p.id === "gp-new-99");
    expect(initialProgress).toBeUndefined();

    // Run import payload effect
    await Effect.runPromise(importSessionPayload(jsonString));

    // Verify that a progress record has been initialized locally with starting metrics
    const storedProgress = grammarPointStore.state.peek().find(p => p.id === "gp-new-99");
    expect(storedProgress).toBeDefined();
    expect(storedProgress?.easeFactor).toBe(2.5);
    expect(storedProgress?.repetitions).toBe(0);
    expect(storedProgress?.intervalDays).toBe(0);

    // Assert that the local outbox queue received a corresponding transaction to sync with the backend
    const pendingKeys = await get<string[]>("outbox_pending_keys", outboxStore);
    expect(pendingKeys).toBeDefined();
    expect(pendingKeys?.length).toBeGreaterThan(0);

    const latestTxKey = `tx:${pendingKeys![pendingKeys!.length - 1]}`;
    const transaction = await get<any>(latestTxKey, outboxStore);
    expect(transaction).toBeDefined();
    expect(transaction.type).toBe("record_review");
    expect(transaction.payload.grammarPointId).toBe("gp-new-99");
    expect(transaction.payload.easeFactor).toBe(2.5);
  });
});
