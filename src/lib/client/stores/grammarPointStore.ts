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