import { createLocalStore } from "../storage/LocalStoreFactory";

export interface GrammarPointProgress {
  readonly id: string; // Represents grammar_point_id
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
}

export const grammarPointStore = createLocalStore<GrammarPointProgress>(
  "grammar_points",
  (a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);

export interface GrammarPointCatalogItem {
  readonly id: string;
  readonly formal_name: string;
  readonly base_meaning: string;
  readonly difficulty_level: string;
}

export const grammarPointCatalogStore = createLocalStore<GrammarPointCatalogItem>(
  "grammar_point_catalog"
);
