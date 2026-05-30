import { signal, computed } from "@preact/signals-core";
import { clientLog } from "../clientLog.ts";
import { runClientUnscoped } from "../runtime.ts";

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

export const weaveSessionCards = (cards: readonly SessionCard[]): readonly SessionCard[] => {
  runClientUnscoped(clientLog("info", `[activeSessionStore] Weaving ${cards.length} session cards to prevent back-to-back duplicates...`));
  
  if (cards.length === 0) {
    runClientUnscoped(clientLog("debug", "[activeSessionStore] Empty session list provided. Returning empty array."));
    return [];
  }

  // Group cards by grammarPointId
  const bins: Record<string, SessionCard[]> = {};
  for (const card of cards) {
    if (!bins[card.grammarPointId]) {
      bins[card.grammarPointId] = [];
    }
    bins[card.grammarPointId]!.push(card);
  }

  const keys = Object.keys(bins);
  runClientUnscoped(clientLog("info", `[activeSessionStore] Grouped cards into ${keys.length} unique grammar bins.`));

  // Randomize initial bin order and shuffle cards inside each bin
  const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);
  const shuffledBins = shuffledKeys.map((key) => {
    const binCards = [...bins[key]!].sort(() => Math.random() - 0.5);
    return binCards;
  });

  const result: SessionCard[] = [];
  let hasMore = true;

  while (hasMore) {
    hasMore = false;
    for (const bin of shuffledBins) {
      if (bin.length > 0) {
        result.push(bin.shift()!);
        if (bin.length > 0) {
          hasMore = true;
        }
      }
    } 
  }

  runClientUnscoped(clientLog("info", `[activeSessionStore] Weave shuffle completed. Final sequence of ${result.length} cards generated.`));
  return result;
};

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
    const weaved = weaveSessionCards(cards);
    const cappedCards = weaved.slice(0, 20);
    masterList.value = cappedCards;
    batchIndex.value = 0;
    state.value = cappedCards.slice(0, BATCH_SIZE);
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