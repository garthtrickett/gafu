import { describe, it, expect, beforeEach } from "vitest";
import { activeSessionStore, type SessionCard } from "./activeSessionStore";

describe("ActiveSessionStore - Signals & State", () => {
  beforeEach(() => {
    activeSessionStore.clear();
  });

  it("should initialize with an empty session state", () => {
    expect(activeSessionStore.state.value).toEqual([]);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.currentCard.value).toBeNull();
  });

  it("should load a study session correctly", () => {
    const mockCards: readonly SessionCard[] = [
      {
        grammarPointId: "gp_1",
        englishContext: "At a sushi bar expressing desire",
        japaneseSentence: "食べたい",
        furigana: []
      },
      {
        grammarPointId: "gp_2",
        englishContext: "Asking politely for water",
        japaneseSentence: "ください",
        furigana: []
      }
    ];

    activeSessionStore.loadSession(mockCards);

    expect(activeSessionStore.state.value).toHaveLength(2);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.isFinished.value).toBe(false);
    expect(activeSessionStore.currentCard.value).toEqual(mockCards[0]);
  });

  it("should advance indices and finish gracefully", () => {
    const mockCards: readonly SessionCard[] = [
      {
        grammarPointId: "gp_1",
        englishContext: "At a sushi bar",
        japaneseSentence: "食べたい",
        furigana: []
      },
      {
        grammarPointId: "gp_2",
        englishContext: "Asking politely",
        japaneseSentence: "ください",
        furigana: []
      }
    ];

    activeSessionStore.loadSession(mockCards);
    activeSessionStore.next();

    expect(activeSessionStore.currentIndex.value).toBe(1);
    expect(activeSessionStore.currentCard.value).toEqual(mockCards[1]);
    expect(activeSessionStore.isFinished.value).toBe(false);

    activeSessionStore.next();
    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.currentCard.value).toBeNull();
  });
});
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
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: "" }, // mastered (reps >= 3)
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, nextReview: "" }, // mastered (intervalDays >= 7)
        { id: "3", easeFactor: 2.5, repetitions: 3, intervalDays: 7, nextReview: "" }, // mastered (both)
        { id: "4", easeFactor: 2.5, repetitions: 4, intervalDays: 12, nextReview: "" }, // mastered
        { id: "5", easeFactor: 2.5, repetitions: 1, intervalDays: 2, nextReview: "" }, // NOT mastered
      ];

      // 4/5 = 80%
      expect(canUnlockMoreRules(progress)).toBe(true);
    });

    it("should return false if less than 80% of active learning rules are mastered", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: "" }, // mastered
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, nextReview: "" }, // mastered
        { id: "3", easeFactor: 2.5, repetitions: 1, intervalDays: 2, nextReview: "" }, // NOT mastered
        { id: "4", easeFactor: 2.5, repetitions: 0, intervalDays: 0, nextReview: "" }, // NOT mastered
        { id: "5", easeFactor: 2.5, repetitions: 2, intervalDays: 3, nextReview: "" }, // NOT mastered
      ];

      // 2/5 = 40% < 80%
      expect(canUnlockMoreRules(progress)).toBe(false);
    });

    it("should ignore graduated rules when evaluating mastery of active learning rules", () => {
      const progress: GrammarPointProgress[] = [
        { id: "1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, nextReview: "" }, // mastered active
        { id: "2", easeFactor: 2.5, repetitions: 0, intervalDays: 8, nextReview: "" }, // mastered active
        { id: "3", easeFactor: 2.5, repetitions: 3, intervalDays: 7, nextReview: "" }, // mastered active
        { id: "4", easeFactor: 2.5, repetitions: 4, intervalDays: 12, nextReview: "" }, // mastered active
        { id: "5", easeFactor: 2.5, repetitions: 1, intervalDays: 2, nextReview: "" }, // NOT mastered active
        { id: "6", easeFactor: 2.5, repetitions: 0, intervalDays: 30, nextReview: "" }, // Graduated rule (interval >= 21) - should be ignored
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
