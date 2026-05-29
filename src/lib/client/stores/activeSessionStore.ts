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
}

const state = signal<readonly SessionCard[]>([]);
const currentIndex = signal<number>(0);

export const activeSessionStore = {
  state,
  currentIndex,
  
  isFinished: computed(() => {
    const cards = state.value;
    return cards.length === 0 || currentIndex.value >= cards.length;
  }),
  
  currentCard: computed(() => {
    const cards = state.value;
    const idx = currentIndex.value;
    return cards[idx] || null;
  }),
  
  loadSession: (cards: readonly SessionCard[]) => {
    state.value = cards;
    currentIndex.value = 0;
  },
  
  next: () => {
    if (currentIndex.value < state.value.length) {
      currentIndex.value += 1;
    }
  },
  
  clear: () => {
    state.value = [];
    currentIndex.value = 0;
  }
};