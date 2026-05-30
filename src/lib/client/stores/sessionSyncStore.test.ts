import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { generateExportPayload } from "./sessionSyncStore";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore";

describe("sessionSyncStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should slice the exported queue to a maximum of 40 elements", async () => {
    const mockProgress = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      easeFactor: 2.5,
      repetitions: 0,
      intervalDays: 0,
      nextReview: new Date().toISOString(),
    }));

    const mockCatalog = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));

    vi.spyOn(grammarPointStore, "load").mockReturnValue(Effect.void);
    vi.spyOn(grammarPointCatalogStore, "load").mockReturnValue(Effect.void);
    
    grammarPointStore.state.value = mockProgress;
    grammarPointCatalogStore.state.value = mockCatalog;

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const program = generateExportPayload();
    const resultJson = await Effect.runPromise(program);
    const parsed = JSON.parse(resultJson);

    expect(parsed.queue.length).toBe(40);
    expect(writeTextMock).toHaveBeenCalled();
  });
});
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
    // 1. Seed 50 rules in the global catalog
    const catalogItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // 2. Create 50 active progress records that are ALL due right now (nextReview is 2 hours in the past)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const progressItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      easeFactor: 2.5,
      repetitions: 1,
      intervalDays: 1,
      nextReview: twoHoursAgo,
    }));
    await runClientPromise(grammarPointStore.putAll(progressItems));

    // 3. Compile the export payload
    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    // 4. Assert that the exported queue was strictly capped to the oldest 15 due items
    expect(payload.queue).toHaveLength(15);
    expect(payload.queue[0]?.grammar_point_id).toBe("gp-0");
    expect(payload.queue[14]?.grammar_point_id).toBe("gp-14");
  });

  it("should unlock and append up to 3 new rules for eligible users who meet the 80% mastery gate", async () => {
    // 1. Seed 5 catalog rules
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // 2. Create 2 progress items that are both active and highly mastered (repetitions = 3), and due today
    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: past },
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: past },
      ])
    );

    // 3. Compile the export payload
    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    // 4. Since the queue has 2 due items, and user is eligible for more (2/2 = 100% mastered),
    // we should append 3 new rules (gp-2, gp-3, gp-4).
    expect(payload.queue).toHaveLength(5);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual([
      "gp-0",
      "gp-1",
      "gp-2",
      "gp-3",
      "gp-4",
    ]);

    // 5. Verify the 3 new rules are immediately saved locally with unlockedAt set
    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(5);
    expect(finalProgress[2]?.unlockedAt).toBeDefined();
    expect(finalProgress[3]?.unlockedAt).toBeDefined();
    expect(finalProgress[4]?.unlockedAt).toBeDefined();
  });

  it("should append 0 new rules for ineligible users who do not meet the 80% mastery gate", async () => {
    // 1. Seed 5 catalog rules
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // 2. Create 2 progress items that are due, but NOT mastered (repetitions = 0)
    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, nextReview: past },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, nextReview: past },
      ])
    );

    // 3. Compile the export payload
    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    // 4. Since user failed the mastery gate, 0 new rules should be appended. Queue remains strictly at 2 due rules.
    expect(payload.queue).toHaveLength(2);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual(["gp-0", "gp-1"]);

    // 5. Verify no new local progress records were generated
    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });
});
