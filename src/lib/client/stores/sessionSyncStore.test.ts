import { describe, it, expect, beforeEach } from "vitest";
import { runClientPromise } from "../runtime.ts";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore.ts";
import { generateExportPayload, importSessionPayload } from "./sessionSyncStore.ts";

describe("sessionSyncStore export payload gating integration tests", () => {
  beforeEach(async () => {
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(grammarPointCatalogStore.clear());
  });

  it("should cap massive backlogs of due rules to a maximum of 15 items in the exported queue sorted by retrievability", async () => {
    const catalogItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // Seed progress with varying lastReviewedAt dates to create a clear retrievability gradient
    const nowMs = Date.now();
    const progressItems = Array.from({ length: 50 }, (_, i) => {
      // i = 0 was reviewed 50 hours ago (lowest retrievability, highest priority)
      // i = 49 was reviewed 1 hour ago (highest retrievability, lowest priority)
      const hoursAgo = 50 - i;
      const lastReviewedAt = new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();
      return {
        id: `gp-${i}`,
        easeFactor: 2.5,
        repetitions: 1,
        intervalDays: 1,
        difficulty: 5.0,
        stability: 24.0,
        lastReviewedAt,
        nextReview: new Date().toISOString(),
        hlc: "0000000000000:0000:initial"
      };
    });
    await runClientPromise(grammarPointStore.putAll(progressItems));

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(15);
    // gp-0 has been reviewed longest ago, so it has the lowest retrievability and is placed first
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
        { id: "gp-0", easeFactor: 2.5, repetitions: 3, intervalDays: 1, stability: 8.0, difficulty: 4.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, stability: 8.0, difficulty: 4.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" },
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

    it("should stamp newly unlocked grammar points with a valid ticked HLC during generation", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // Trigger payload generation to unlock new rules
    await runClientPromise(generateExportPayload());

    const progress = grammarPointStore.state.peek();
    expect(progress.length).toBeGreaterThan(0);
    
    // Verify that every single unlocked progress record is securely stamped with a valid ticked HLC
    for (const record of progress) {
      expect(record.hlc).toBeDefined();
      expect(typeof record.hlc).toBe("string");
      expect(record.hlc).not.toBe("0000000000000:0000:initial");
    }
  });

  it("should stamp newly activated grammar points with a valid ticked HLC during import", async () => {
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11",
          english_context: "Import HLC check context.",
          japanese_sentence: "学生です。",
          explanation: "Copula test."
        }
      ]
    };

    await runClientPromise(importSessionPayload(JSON.stringify(mockPayload)));

    const progress = grammarPointStore.state.peek().find(p => p.id === "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11");
    expect(progress).toBeDefined();
    expect(progress!.hlc).toBeDefined();
    expect(typeof progress!.hlc).toBe("string");
    expect(progress!.hlc).not.toBe("0000000000000:0000:initial");
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
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(2);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual(["gp-0", "gp-1"]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });

  it("should unlock and append up to 3 new rules for ineligible users if enforceMasteryGates is toggled off", async () => {
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
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    // Disable mastery gate enforcement
    const preferences = await import("./userPreferencesStore.ts");
    await runClientPromise(preferences.userPreferencesStore.updateLimits(20, 3, false));

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    // Verify that new rules were introduced despite < 80% mastery
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
  });

  it("should compile a cram payload containing unmastered active rules regardless of due state, with cram instructions", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const future = new Date(Date.now() + 100000).toISOString(); // future -> not due
    const past = new Date(Date.now() - 100000).toISOString(); // past -> due
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: future, hlc: "0000000000000:0000:initial" }, // active, unmastered, NOT due
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 10, stability: 10.0, difficulty: 5.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" }, // active, mastered, due
      ])
    );

    // Re-enable gate
    const preferences = await import("./userPreferencesStore.ts");
    await runClientPromise(preferences.userPreferencesStore.updateLimits(20, 3, true));

    const jsonString = await runClientPromise(generateExportPayload({ isCram: true }));
    const payload = JSON.parse(jsonString);

    // The cram payload should contain gp-0 (unmastered, despite being in the future), and NOT gp-1 (mastered)
    expect(payload.queue).toHaveLength(1);
    expect(payload.queue[0]?.grammar_point_id).toBe("gp-0");

    // Verify instructions contain cram-specific terminology
    expect(payload.instructions).toContain("CRAM/REINFORCEMENT");

    // Verify no new rules are unlocked
    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });
});
