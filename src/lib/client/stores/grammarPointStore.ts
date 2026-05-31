import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { computed } from "@preact/signals-core";
import { userPreferencesStore } from "./userPreferencesStore.ts";

export interface GrammarPointProgress {
  readonly id: string; // Represents grammar_point_id
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly unlockedAt?: string; // ISO string representing when the rule was unlocked
  readonly hlc?: string;
}

export interface GrammarPointCatalogItem {
  readonly id: string;
  readonly formal_name: string;
  readonly base_meaning: string;
  readonly difficulty_level: string;
  readonly hlc?: string;
}

export const grammarPointCatalogStore = createLocalStore<GrammarPointCatalogItem>(
  "grammar_point_catalog"
);

const baseGrammarPointStore = createLocalStore<GrammarPointProgress>(
  "grammar_points",
  (a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);

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

  activeLearningRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => p.intervalDays < 21);
  }),

  graduatedRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => p.intervalDays >= 21);
  }),

  lockedCatalogItems: computed(() => {
    const catalog = grammarPointCatalogStore.state.value;
    const progress = baseGrammarPointStore.state.value;
    const progressIds = new Set(progress.map(p => p.id));
    return catalog.filter(c => !progressIds.has(c.id));
  }),

    unlockedLast24HoursCount: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    const limit = userPreferencesStore.dailyNewRuleLimit.value;
    return getDailyUnlockAllowance(progress, limit);
  }),

  activeMasteryRate: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    const learningRules = progress.filter(p => p.intervalDays < 21);
    if (learningRules.length === 0) {
      return 100;
    }
    const masteredCount = learningRules.filter(
      p => p.repetitions >= 3 || p.intervalDays >= 7
    ).length;
    return Math.round((masteredCount / learningRules.length) * 100);
  }),

  unmasteredActiveRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    const learningRules = progress.filter(p => p.intervalDays < 21);
    return learningRules.filter(
      p => !(p.repetitions >= 3 || p.intervalDays >= 7)
    );
  }),
};
