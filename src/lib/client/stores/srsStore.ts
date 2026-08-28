import { createLocalStore } from "../storage/LocalStoreFactory";

export interface SrsCardClient {
  readonly id: string;
  readonly knowledgePointId?: string;
  readonly front: string;
  readonly back: string;
  readonly audioUrl?: string | null;
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly difficulty?: number;
  readonly stability?: number;
  readonly lastReviewedAt?: string | null;
  readonly hlc?: string;
}

export const srsStore = createLocalStore<SrsCardClient>("srs", (a, b) => 
  new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);
