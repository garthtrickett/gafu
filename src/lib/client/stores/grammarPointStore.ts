import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { computed } from "@preact/signals-core";

export interface GrammarPointProgress {
  readonly id: string; // Represents grammar_point_id
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly unlockedAt?: string; // ISO string representing when the rule was unlocked
}

export interface GrammarPointCatalogItem {
  readonly id: string;
  readonly formal_name: string;
  readonly base_meaning: string;
  readonly difficulty_level: string;
}

export const grammarPointCatalogStore = createLocalStore<GrammarPointCatalogItem>(
  "grammar_point_catalog"
);

const baseGrammarPointStore = createLocalStore<GrammarPointProgress>(
  "grammar_points",
  (a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);

/**
 * Determines whether the user has achieved enough mastery over active learning rules
 * to qualify for unlocking more rules. Requires >= 80% of active rules to meet the mastery thresholds.
 */
export const canUnlockMoreRules = (progressList: GrammarPointProgress[]): boolean => {
  const learningRules = progressList.filter(p => p.intervalDays < 21);
  if (learningRules.length === 0) {
    return true;
  }

  const masteredCount = learningRules.filter(
    p => p.repetitions >= 3 || p.intervalDays >= 7
  ).length;

  return (masteredCount / learningRules.length) >= 0.8;
};

/**
 * Calculates how many slots are remaining today (rolling 24h window) for introducing new rules.
 */
export const getDailyUnlockAllowance = (
  progressList: GrammarPointProgress[],
  dailyCap: number = 3
): number => {
  const now = Date.now();
  const limit = now - 24 * 60 * 60 * 1000;

  const unlockedCount = progressList.filter(p => {
    if (!p.unlockedAt) return false;
    const time = new Date(p.unlockedAt).getTime();
    return time >= limit && time <= now;
  }).length;

  return Math.max(0, dailyCap - unlockedCount);
};

export const grammarPointStore = { 
  ...baseGrammarPointStore,

  /**
   * Computed list of active learning progress items (not yet graduated)
   */
  readonly activeLearningRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => p.intervalDays < 21);
  }),

  /**
   * Computed list of graduated progress items (intervalDays >= 21)
   */
  readonly graduatedRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => p.intervalDays >= 21);
  }),

  /**
   * Computed list of locked catalog items (not yet in progress)
   */
  readonly lockedCatalogItems: computed(() => {
    const catalog = grammarPointCatalogStore.state.value;
    const progress = baseGrammarPointStore.state.value;
    const progressIds = new Set(progress.map(p => p.id));
    return catalog.filter(c => !progressIds.has(c.id));
  }),

  /**
   * Computed count of rules unlocked within the last 24 hours
   */
  readonly unlockedLast24HoursCount: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return getDailyUnlockAllowance(progress, 3);
  }),
};
