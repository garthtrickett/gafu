import { signal, computed } from "@preact/signals-core";

export interface FuriganaSegment {
  readonly kanji: string;
  readonly kana?: string;
}

export interface SessionCard {
  readonly grammarPointId: string;
  readonly englishContext: string;
  readonly japaneseSentence: string;
  readonly furigana: readonly FuriganaSegment[];
  readonly audioUrl?: string | null;
  readonly explanation?: string;
}

const BATCH_SIZE = 15;

const masterList = signal<readonly SessionCard[]>([]);
const state = signal<readonly SessionCard[]>([]);
const currentIndex = signal<number>(0);
const batchIndex = signal<number>(0);

export const activeSessionStore = {
  state,
  currentIndex,
  masterList,
  batchIndex,
  
  isFinished: computed(() => {
    const cards = state.value;
    return cards.length === 0 || currentIndex.value >= cards.length;
  }),
  
  currentCard: computed(() => {
    const cards = state.value;
    const idx = currentIndex.value;
    return cards[idx] || null;
  }),
  
  hasMoreBatches: computed(() => {
    return (batchIndex.value + 1) * BATCH_SIZE < masterList.value.length;
  }),
  
      loadSession: (cards: readonly SessionCard[]) => {
    masterList.value = cards;
    batchIndex.value = 0;
    state.value = cards.slice(0, BATCH_SIZE);
    currentIndex.value = 0;
  },
  
  startNextBatch: () => {
    const nextIndex = batchIndex.value + 1;
    const start = nextIndex * BATCH_SIZE;
    if (start < masterList.value.length) {
      batchIndex.value = nextIndex;
      state.value = masterList.value.slice(start, start + BATCH_SIZE);
      currentIndex.value = 0;
    }
  },
  
  next: () => {
    if (currentIndex.value < state.value.length) {
      currentIndex.value += 1;
    }
  },
  
  clear: () => {
    masterList.value = [];
    state.value = [];
    currentIndex.value = 0;
    batchIndex.value = 0;
  }
};