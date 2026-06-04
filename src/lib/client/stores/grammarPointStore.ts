import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { computed } from "@preact/signals-core";
import { userPreferencesStore } from "./userPreferencesStore.ts";

export interface GrammarPointProgress {
  readonly id: string; // Represents grammar_point_id
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly difficulty?: number;
  readonly stability?: number;
  readonly lastReviewedAt?: string | null;
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

export const calculateRetrievability = (progress: { stability?: number; lastReviewedAt?: string | null }) => {
  const stability = progress.stability ?? 0.0;
  if (stability === 0.0 || !progress.lastReviewedAt) {
    return 0.0; // Brand new or never reviewed: highest priority
  }
  const elapsedMs = Date.now() - new Date(progress.lastReviewedAt).getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  return Math.max(0.0, Math.min(1.0, Math.pow(0.9, elapsedDays / stability)));
};

export const canUnlockMoreRules = (progressList: GrammarPointProgress[]): boolean => {
  const learningRules = progressList.filter(p => (p.stability ?? 0.0) < 21.0);
  if (learningRules.length === 0) {
    return true;
  }

  const masteredCount = learningRules.filter(
    p => (p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0
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
    return progress.filter(p => (p.stability ?? 0.0) < 21.0);
  }),

  graduatedRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => (p.stability ?? 0.0) >= 21.0);
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
    const learningRules = progress.filter(p => (p.stability ?? 0.0) < 21.0);
    if (learningRules.length === 0) {
      return 100;
    }
    const masteredCount = learningRules.filter(
      p => (p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0
    ).length;
    return Math.round((masteredCount / learningRules.length) * 100);
  }),

    unmasteredActiveRules: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    const learningRules = progress.filter(p => (p.stability ?? 0.0) < 21.0);
    return learningRules.filter(
      p => !((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    );
  }),

  unstartedCount: computed(() => {
    const catalog = grammarPointCatalogStore.state.value;
    const progress = baseGrammarPointStore.state.value;
    const progressMap = new Map(progress.map(p => [p.id, p]));
    let count = 0;
    for (const cat of catalog) {
      const prog = progressMap.get(cat.id);
      if (!prog || prog.repetitions === 0) {
        count++;
      }
    }
    return count;
  }),

  learningCount: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => 
      (p.stability ?? 0.0) < 21.0 &&
      p.repetitions > 0 &&
      !((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    ).length;
  }),

  masteredCount: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => 
      (p.stability ?? 0.0) < 21.0 &&
      ((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    ).length;
  }),

  graduatedCount: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    return progress.filter(p => (p.stability ?? 0.0) >= 21.0).length;
  }),

  averageDifficulty: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    const studied = progress.filter(p => p.repetitions > 0);
    if (studied.length === 0) {
      return 5.0;
    }
    const sum = studied.reduce((acc, curr) => acc + (curr.difficulty ?? 5.0), 0);
    return Math.round((sum / studied.length) * 100) / 100;
  }),

  averageRetrievability: computed(() => {
    const progress = baseGrammarPointStore.state.value;
    if (progress.length === 0) {
      return 100;
    }
    const sum = progress.reduce((acc, curr) => acc + calculateRetrievability(curr), 0);
    return Math.round((sum / progress.length) * 100);
  }),
};
