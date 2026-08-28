import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import type { LocalStore } from "../storage/LocalStoreFactory.ts";
import { computed } from "@preact/signals-core";
import { userPreferencesStore } from "./userPreferencesStore.ts";

export interface KnowledgePointProgress {
  readonly id: string;
  readonly kind?: "grammar" | "vocabulary";
  readonly participationStatus?: "active" | "archived";
  readonly learningState?: "introduced" | "primed" | "encountered" | "learning" | "stable" | "known";
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly difficulty?: number;
  readonly stability?: number;
  readonly lastReviewedAt?: string | null;
  readonly unlockedAt?: string; // ISO string representing when the rule was unlocked
  readonly checkoutDue?: boolean;
  readonly hlc?: string;
}

export interface GrammarPointCatalogItem {
  readonly id: string;
  readonly formal_name: string;
  readonly base_meaning: string;
  readonly difficulty_level: string;
  readonly hlc?: string;
}

export interface VocabularyPointCatalogItem {
  readonly id: string;
  readonly kind: "vocabulary";
  readonly canonical_key: string;
  readonly scope: "curated" | "personal";
  readonly catalogue_status: "active" | "archived" | "quarantined";
  readonly lemma: string;
  readonly reading: string;
  readonly part_of_speech: string;
  readonly sense_key: string;
  readonly meaning: string;
  readonly register?: string | null;
  readonly hlc?: string;
}

export type KnowledgePointCatalogItem =
  | (GrammarPointCatalogItem & { readonly kind?: "grammar" })
  | VocabularyPointCatalogItem;

export const knowledgePointCatalogStore = createLocalStore<KnowledgePointCatalogItem>(
  "knowledge_point_catalog"
);

const baseKnowledgePointStore = createLocalStore<KnowledgePointProgress>(
  "learner_progress",
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

export const canUnlockMoreRules = (progressList: KnowledgePointProgress[]): boolean => {
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
  progressList: KnowledgePointProgress[],
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

export const knowledgePointStore = {
  ...baseKnowledgePointStore,

  activeLearningRules: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    return progress.filter(p => p.participationStatus !== "archived" && p.learningState !== "known" && (p.stability ?? 0.0) < 21.0);
  }),

  graduatedRules: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    return progress.filter(p => (p.stability ?? 0.0) >= 21.0);
  }),

  lockedCatalogItems: computed(() => {
    const catalog = knowledgePointCatalogStore.state.value;
    const progress = baseKnowledgePointStore.state.value;
    const progressIds = new Set(progress.map(p => p.id));
    return catalog.filter(c => !progressIds.has(c.id));
  }),

  unlockedLast24HoursCount: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    const limit = userPreferencesStore.dailyNewRuleLimit.value;
    return getDailyUnlockAllowance(progress, limit);
  }),

  activeMasteryRate: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
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
    const progress = baseKnowledgePointStore.state.value;
    const learningRules = progress.filter(p => (p.stability ?? 0.0) < 21.0);
    return learningRules.filter(
      p => !((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    );
  }),

  unstartedCount: computed(() => {
    const catalog = knowledgePointCatalogStore.state.value;
    const progress = baseKnowledgePointStore.state.value;
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
    const progress = baseKnowledgePointStore.state.value;
    return progress.filter(p => 
      (p.stability ?? 0.0) < 21.0 &&
      p.repetitions > 0 &&
      !((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    ).length;
  }),

  masteredCount: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    return progress.filter(p => 
      (p.stability ?? 0.0) < 21.0 &&
      ((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0)
    ).length;
  }),

  graduatedCount: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    return progress.filter(p => (p.stability ?? 0.0) >= 21.0).length;
  }),

  averageDifficulty: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    const studied = progress.filter(p => p.repetitions > 0);
    if (studied.length === 0) {
      return 5.0;
    }
    const sum = studied.reduce((acc, curr) => acc + (curr.difficulty ?? 5.0), 0);
    return Math.round((sum / studied.length) * 100) / 100;
  }),

  averageRetrievability: computed(() => {
    const progress = baseKnowledgePointStore.state.value;
    if (progress.length === 0) {
      return 100;
    }
    const sum = progress.reduce((acc, curr) => acc + calculateRetrievability(curr), 0);
    return Math.round((sum / progress.length) * 100);
  }),
};

// Temporary grammar UI compatibility exports. Both point at the shared stores;
// no production persistence path writes the old collection names.
export type GrammarPointProgress = KnowledgePointProgress;
export const grammarPointCatalogStore = knowledgePointCatalogStore as unknown as LocalStore<GrammarPointCatalogItem>;
export const grammarPointStore = {
  ...knowledgePointStore,
  lockedCatalogItems: computed(() =>
    knowledgePointStore.lockedCatalogItems.value.filter(
      (item): item is GrammarPointCatalogItem & { readonly kind?: "grammar" } => item.kind !== "vocabulary",
    ),
  ),
};
