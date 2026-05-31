import { createLocalStore } from "../storage/LocalStoreFactory";

interface Deck {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly content: unknown;
  readonly hlc?: string;
}

export const deckStore = createLocalStore<Deck>("decks");
