import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { computed } from "@preact/signals-core";
import { userPreferencesStore } from "./userPreferencesStore.ts";
import { Effect } from "effect";

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

  load: () => {
    const effect = Effect.gen(function* () {
      yield* baseGrammarPointStore.load();
      const current = baseGrammarPointStore.state.peek();
      let needsWrite = false;
      const updatedList: GrammarPointProgress[] = [];

      for (const item of current) {
        if (
          item.difficulty === undefined ||
          item.stability === undefined ||
          (item.repetitions > 0 && item.stability === 0.0) ||
          (item.intervalDays > 0 && item.stability === 0.0) ||
          item.lastReviewedAt === undefined
        ) {
          needsWrite = true;
          const ease = item.easeFactor ?? 2.5;
          const calculatedDifficulty = Math.round(Math.max(1.0, Math.min(10.0, 5.0 + (2.5 - ease) * 4.0)) * 100) / 100;
          const calculatedStability = item.intervalDays ?? 0.0;
          
          let calculatedLastReviewed: string | null = item.lastReviewedAt ?? null;
          if (!calculatedLastReviewed && (item.repetitions > 0 || item.intervalDays > 0)) {
            const nextDate = new Date(item.nextReview);
            nextDate.setDate(nextDate.getDate() - item.intervalDays);
            calculatedLastReviewed = nextDate.toISOString();
          }

          updatedList.push({
            ...item,
            difficulty: calculatedDifficulty,
            stability: calculatedStability,
            lastReviewedAt: calculatedLastReviewed,
          });
        } else {
          updatedList.push(item);
        }
      }

      if (needsWrite) {
        yield* baseGrammarPointStore.putAll(updatedList);
      }
    });
    return effect;
  },

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
};
