import { createLocalStore } from "../storage/LocalStoreFactory";

interface CardMetadata {
  readonly id: string;
  readonly audioUrl?: string;
  readonly nextReview: string;
}

export const srsStore = createLocalStore<CardMetadata>("srs", (a, b) => 
  new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);
