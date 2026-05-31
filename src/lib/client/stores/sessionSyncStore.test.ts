import { describe, it, expect, beforeEach } from "vitest";
import { runClientPromise } from "../runtime.ts";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore.ts";
import { generateExportPayload } from "./sessionSyncStore.ts";

describe("sessionSyncStore export payload gating integration tests", () => {
  beforeEach(async () => {
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(grammarPointCatalogStore.clear());
  });

  it("should cap massive backlogs of due rules to a maximum of 15 items in the exported queue", async () => {
    const catalogItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const progressItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      easeFactor: 2.5,
      repetitions: 1,
      intervalDays: 1,
      nextReview: twoHoursAgo,
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointStore.putAll(progressItems));

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(15);
    expect(payload.queue[0]?.grammar_point_id).toBe("gp-0");
    expect(payload.queue[14]?.grammar_point_id).toBe("gp-14");
  });

  it("should unlock and append up to 3 new rules for eligible users who meet the 80% mastery gate", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(5);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual([
      "gp-0",
      "gp-1",
      "gp-2",
      "gp-3",
      "gp-4",
    ]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(5);
    expect(finalProgress[2]?.unlockedAt).toBeDefined();
    expect(finalProgress[3]?.unlockedAt).toBeDefined();
    expect(finalProgress[4]?.unlockedAt).toBeDefined();
  });

  it("should append 0 new rules for ineligible users who do not meet the 80% mastery gate", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(2);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual(["gp-0", "gp-1"]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });
});
