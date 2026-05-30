import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import { generateExportPayload } from "./sessionSyncStore";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore";

describe("sessionSyncStore - Export Gating & Expansion", () => {
  beforeEach(async () => {
    await Effect.runPromise(grammarPointStore.clear());
    await Effect.runPromise(grammarPointCatalogStore.clear());
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
});
