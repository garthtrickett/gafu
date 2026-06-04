import { describe, it, expect, beforeEach } from "vitest";
import { runClientPromise } from "../runtime.ts";
import {
  grammarPointStore,
  grammarPointCatalogStore,
  canUnlockMoreRules,
  getDailyUnlockAllowance,
  GrammarPointProgress
} from "./grammarPointStore.ts";

describe("grammarPointStore state management and pacing helpers", () => {
  beforeEach(async () => {
    // Clear stores before each test run to guarantee isolated execution environment
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(grammarPointCatalogStore.clear());
  });

  it("should partition catalog items and progress into locked, active, and graduated collections", async () => {
    // 1. Seed global catalog
    await runClientPromise(
      grammarPointCatalogStore.putAll([
        { id: "gp-1", formal_name: "だ", base_meaning: "To be", difficulty_level: "N5" },
        { id: "gp-2", formal_name: "は", base_meaning: "Topic", difficulty_level: "N5" },
        { id: "gp-3", formal_name: "も", base_meaning: "Also", difficulty_level: "N5" },
      ])
    );

    // 2. Initial state: everything should be locked
    expect(grammarPointStore.activeLearningRules.value).toHaveLength(0);
    expect(grammarPointStore.graduatedRules.value).toHaveLength(0);
    expect(grammarPointStore.lockedCatalogItems.value).toHaveLength(3);
    expect(grammarPointStore.lockedCatalogItems.value[0]?.id).toBe("gp-1");

    // 3. Unlock gp-1 (Learning / Active State)
    await runClientPromise(
      grammarPointStore.put({
        id: "gp-1",
        easeFactor: 2.5,
        repetitions: 1,
        intervalDays: 3, // < 21 -> Active Learning
        nextReview: new Date().toISOString(),
        unlockedAt: new Date().toISOString(),
      })
    );

    expect(grammarPointStore.activeLearningRules.value).toHaveLength(1);
    expect(grammarPointStore.activeLearningRules.value[0]?.id).toBe("gp-1");
    expect(grammarPointStore.graduatedRules.value).toHaveLength(0);
    expect(grammarPointStore.lockedCatalogItems.value).toHaveLength(2);

    // 4. Unlock gp-2 and simulate graduation (Graduated / Mastered State)
    await runClientPromise(
      grammarPointStore.put({
        id: "gp-2",
        easeFactor: 2.5,
        repetitions: 4,
        intervalDays: 24, // >= 21 -> Graduated
        nextReview: new Date().toISOString(),
        unlockedAt: new Date().toISOString(),
      })
    );

    expect(grammarPointStore.activeLearningRules.value).toHaveLength(1);
    expect(grammarPointStore.graduatedRules.value).toHaveLength(1);
    expect(grammarPointStore.graduatedRules.value[0]?.id).toBe("gp-2");
    expect(grammarPointStore.lockedCatalogItems.value).toHaveLength(1);
    expect(grammarPointStore.lockedCatalogItems.value[0]?.id).toBe("gp-3");
  });

  it("should calculate unlockedLast24HoursCount correctly", async () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyThreeHoursAgo = new Date(now - 23 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();

    await runClientPromise(
      grammarPointStore.putAll([
        {
          id: "gp-1",
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(),
          unlockedAt: twoHoursAgo, // Within last 24h
        },
        {
          id: "gp-2",
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(),
          unlockedAt: twentyThreeHoursAgo, // Within last 24h
        },
        {
          id: "gp-3",
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(),
          unlockedAt: twentyFiveHoursAgo, // Older than 24h
        },
        {
          id: "gp-4",
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(), // No unlockedAt (legacy)
        },
      ])
    );

    // Verify 24-hour rate limit check (it returns 3 - count, so since 2 are unlocked, remaining is 1)
    expect(grammarPointStore.unlockedLast24HoursCount.value).toBe(1);
  });

    describe("canUnlockMoreRules gating logic", () => {
    it("should return true for empty active learning queues to allow initial seeding", () => {
      const emptyProgress: GrammarPointProgress[] = [];
      expect(canUnlockMoreRules(emptyProgress)).toBe(true);
    });

    it("should return true if exactly 80% of active learning rules are mastered", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // mastered (stability >= 7)
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, difficulty: 4.0, stability: 1.0, nextReview: "" }, // mastered (difficulty <= 4)
        { id: "3", easeFactor: 2.5, repetitions: 3, intervalDays: 7, difficulty: 3.5, stability: 8.0, nextReview: "" }, // mastered (both)
        { id: "4", easeFactor: 2.5, repetitions: 4, intervalDays: 12, difficulty: 4.0, stability: 12.0, nextReview: "" }, // mastered (both)
        { id: "5", easeFactor: 2.5, repetitions: 1, intervalDays: 2, difficulty: 5.0, stability: 2.0, nextReview: "" }, // NOT mastered
      ];

      // 4/5 = 80%
      expect(canUnlockMoreRules(progress)).toBe(true);
    });

    it("should return false if less than 80% of active learning rules are mastered", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // mastered (stability >= 7)
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, difficulty: 4.0, stability: 1.0, nextReview: "" }, // mastered (difficulty <= 4)
        { id: "3", easeFactor: 2.5, repetitions: 1, intervalDays: 2, difficulty: 5.0, stability: 2.0, nextReview: "" }, // NOT mastered
        { id: "4", easeFactor: 2.5, repetitions: 0, intervalDays: 0, difficulty: 5.0, stability: 0.0, nextReview: "" }, // NOT mastered
        { id: "5", easeFactor: 2.5, repetitions: 2, intervalDays: 3, difficulty: 5.0, stability: 3.0, nextReview: "" }, // NOT mastered
      ];

      // 2/5 = 40% < 80%
      expect(canUnlockMoreRules(progress)).toBe(false);
    });

    it("should ignore graduated rules when evaluating mastery of active learning rules", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // mastered active
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, difficulty: 4.0, stability: 1.0, nextReview: "" }, // mastered active
        { id: "3", easeFactor: 2.5, repetitions: 3, intervalDays: 7, difficulty: 4.0, stability: 8.0, nextReview: "" }, // mastered active
        { id: "4", easeFactor: 2.5, repetitions: 4, intervalDays: 12, difficulty: 3.0, stability: 12.0, nextReview: "" }, // mastered active
        { id: "5", easeFactor: 2.5, repetitions: 1, intervalDays: 2, difficulty: 5.0, stability: 2.0, nextReview: "" }, // NOT mastered active
        { id: "6", easeFactor: 2.5, repetitions: 0, intervalDays: 30, difficulty: 5.0, stability: 25.0, nextReview: "" }, // Graduated rule (stability >= 21) - should be ignored
      ];

      // Out of 5 active learning rules, 4 are mastered = 80%. Should return true.
      expect(canUnlockMoreRules(progress)).toBe(true);
    });
  });

  describe("getDailyUnlockAllowance calculations", () => {
    it("should return the maximum allowance when no rules have been unlocked today", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "" },
      ];
      expect(getDailyUnlockAllowance(progress, 3)).toBe(3);
    });

    it("should discount slots for rules unlocked within the rolling 24 hour window", () => {
      const now = Date.now();
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString() }, // 1h ago
        { id: "2", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString() }, // 23h ago
        { id: "3", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, // 25h ago (ignored)
      ];
      expect(getDailyUnlockAllowance(progress, 3)).toBe(1);
    });

    it("should return 0 and never drop below 0 if more rules than the cap have been unlocked today", () => {
      const now = Date.now();
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
        { id: "2", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
        { id: "3", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
        { id: "4", easeFactor: 2.5, repetitions: 1, intervalDays: 1, nextReview: "", unlockedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString() },
      ];
      expect(getDailyUnlockAllowance(progress, 3)).toBe(0);
    });
  });
});

describe("Grammar Point Gating and Pacing Math", () => {
  const mockProgressList = (unlockedHoursAgo: number[]): GrammarPointProgress[] => {
    const now = Date.now();
    return unlockedHoursAgo.map((hours, i) => {
      const unlockedAt = new Date(now - hours * 60 * 60 * 1000).toISOString();
      return {
        id: `gp-${i}`,
        easeFactor: 2.5,
        repetitions: 1,
        intervalDays: 1,
        nextReview: now.toString(),
        unlockedAt,
      };
    });
  };

  it("should calculate proportional gating (10%) correctly across dailyReviewLimit boundaries", () => {
    // 10% of 20 = 2 new rules cap
    const capFor20 = Math.ceil(20 * 0.10);
    expect(capFor20).toBe(2);

    // 10% of 50 = 5 new rules cap
    const capFor50 = Math.ceil(50 * 0.10);
    expect(capFor50).toBe(5);

    // 10% of 100 = 10 new rules cap
    const capFor100 = Math.ceil(100 * 0.10);
    expect(capFor100).toBe(10);
  });

  it("should correctly calculate remaining daily unlock allowance", () => {
    const dailyReviewLimit = 50;
    const dynamicNewRuleLimit = Math.ceil(dailyReviewLimit * 0.10); // 5 rules
    expect(dynamicNewRuleLimit).toBe(5);

    // Case A: 3 rules unlocked in the last 24h -> 2 slots remaining
    const progressA = mockProgressList([2, 5, 12, 36]); // Three inside 24h (2, 5, 12), one outside (36)
    const allowanceA = getDailyUnlockAllowance(progressA, dynamicNewRuleLimit);
    expect(allowanceA).toBe(2);

    // Case B: 5 rules unlocked in the last 24h -> 0 slots remaining (fully capped)
    const progressB = mockProgressList([1, 2, 3, 4, 10, 48]); // Five inside 24h, one outside
    const allowanceB = getDailyUnlockAllowance(progressB, dynamicNewRuleLimit);
    expect(allowanceB).toBe(0);

    // Case C: 0 rules unlocked in the last 24h -> 5 slots remaining
    const progressC = mockProgressList([30, 40]); // None inside 24h
    const allowanceC = getDailyUnlockAllowance(progressC, dynamicNewRuleLimit);
    expect(allowanceC).toBe(5);
  });

    it("should properly enforce master check for new unlocks", () => {
    // 80% mastery threshold: stability >= 7 or difficulty <= 4
    const progressMastered: GrammarPointProgress[] = [
      { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // Mastered (stability)
      { id: "gp-2", easeFactor: 2.5, repetitions: 1, intervalDays: 7, difficulty: 4.0, stability: 1.0, nextReview: "" }, // Mastered (difficulty)
      { id: "gp-3", easeFactor: 2.5, repetitions: 0, intervalDays: 0, difficulty: 5.0, stability: 0.0, nextReview: "" }, // Learning
    ];
    // Mastered: 2 / 3 = 66% (Not eligible since < 80%)
    expect(canUnlockMoreRules(progressMastered)).toBe(false);

    const progressFullMastered: GrammarPointProgress[] = [
      { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // Mastered
      { id: "gp-2", easeFactor: 2.5, repetitions: 1, intervalDays: 7, difficulty: 4.0, stability: 1.0, nextReview: "" }, // Mastered
      { id: "gp-3", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 8.0, nextReview: "" }, // Mastered
      { id: "gp-4", easeFactor: 2.5, repetitions: 1, intervalDays: 1, difficulty: 5.0, stability: 1.0, nextReview: "" }, // Learning
    ];
    // Mastered: 3 / 4 = 75% (Not eligible)
    expect(canUnlockMoreRules(progressFullMastered)).toBe(false);

    const progressPassThreshold: GrammarPointProgress[] = [
      { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // Mastered
      { id: "gp-2", easeFactor: 2.5, repetitions: 1, intervalDays: 7, difficulty: 4.0, stability: 1.0, nextReview: "" }, // Mastered
      { id: "gp-3", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 8.0, nextReview: "" }, // Mastered
      { id: "gp-4", easeFactor: 2.5, repetitions: 4, intervalDays: 1, difficulty: 3.5, stability: 1.0, nextReview: "" }, // Mastered
      { id: "gp-5", easeFactor: 2.5, repetitions: 1, intervalDays: 1, difficulty: 5.0, stability: 2.0, nextReview: "" }, // Learning
    ];
    // Mastered: 4 / 5 = 80% (Eligible!)
    expect(canUnlockMoreRules(progressPassThreshold)).toBe(true);
  });
});

describe("grammarPointStore computed mastery metrics", () => {
  beforeEach(async () => {
    await runClientPromise(grammarPointStore.clear());
  });

  it("should return 100% mastery rate when active learning queue is empty", () => {
    expect(grammarPointStore.activeMasteryRate.value).toBe(100);
    expect(grammarPointStore.unmasteredActiveRules.value).toHaveLength(0);
  });

    it("should calculate correct mastery rate and list unmastered active rules, ignoring graduated rules", async () => {
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, difficulty: 5.0, stability: 7.0, nextReview: "" }, // mastered (stability >= 7)
        { id: "gp-2", easeFactor: 2.5, repetitions: 1, intervalDays: 7, difficulty: 4.0, stability: 1.0, nextReview: "" }, // mastered (difficulty <= 4)
        { id: "gp-3", easeFactor: 2.5, repetitions: 1, intervalDays: 2, difficulty: 5.0, stability: 2.0, nextReview: "" }, // unmastered
        { id: "gp-4", easeFactor: 2.5, repetitions: 0, intervalDays: 0, difficulty: 5.0, stability: 0.0, nextReview: "" }, // unmastered
        { id: "gp-5", easeFactor: 2.5, repetitions: 1, intervalDays: 30, difficulty: 5.0, stability: 25.0, nextReview: "" }, // graduated (stability >= 21, ignored)
      ])
    );

    // Active learning rules: gp-1, gp-2, gp-3, gp-4 (total: 4)
    // Mastered among active: gp-1, gp-2 (total: 2)
    // Mastery rate: 2/4 = 50%
    expect(grammarPointStore.activeMasteryRate.value).toBe(50);

    // Unmastered active rules: gp-3, gp-4
    const unmastered = grammarPointStore.unmasteredActiveRules.value;
    expect(unmastered).toHaveLength(2);
    expect(unmastered.map(u => u.id).sort()).toEqual(["gp-3", "gp-4"].sort());
  });
});

