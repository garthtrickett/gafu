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

  runClientUnscoped(clientLog("info", `[activeSessionStore] Grouped cards into ${Object.keys(bins).length} unique grammar bins.`));

  // Shuffle cards within each bin initially
  for (const gpId of Object.keys(bins)) {
    bins[gpId] = bins[gpId]!.sort(() => Math.random() - 0.5);
  }

  interface Bin {
    gpId: string;
    cards: SessionCard[];
  }

  const activeBins: Bin[] = Object.entries(bins).map(([gpId, binCards]) => ({
    gpId,
    cards: binCards,
  }));

  activeBins.forEach(b => {
    runClientUnscoped(clientLog("info", `[activeSessionStore] Bin gpId=${b.gpId} has ${b.cards.length} cards.`));
  });

  const result: SessionCard[] = [];
  let lastGpId: string | null = null;
  let step = 1;

  while (true) {
    const binsWithCards = activeBins.filter(b => b.cards.length > 0);
    if (binsWithCards.length === 0) {
      runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: No more cards left in any bins. Ending weave loop.`));
      break;
    }

    const allowedBins = binsWithCards.filter(b => b.gpId !== lastGpId);
    runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: lastGpId=${lastGpId}. Bins with cards: ${binsWithCards.map(b => `${b.gpId}(${b.cards.length})`).join(", ")}`));

    let chosenBin: Bin | undefined;

    if (allowedBins.length > 0) {
      const maxCount = Math.max(...allowedBins.map(b => b.cards.length));
      const candidates = allowedBins.filter(b => b.cards.length === maxCount);
      chosenBin = candidates[Math.floor(Math.random() * candidates.length)]!;
      runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: Selected ${chosenBin.gpId} from allowed candidates: ${candidates.map(b => b.gpId).join(", ")}`));
    } else {
      chosenBin = binsWithCards[0]!;
      runClientUnscoped(clientLog("warn", `[activeSessionStore] Step ${step}: Forced to select adjacent duplicate of lastGpId=${lastGpId} from bin ${chosenBin.gpId}`));
    }

    if (chosenBin && chosenBin.cards.length > 0) {
      const card = chosenBin.cards.shift()!;
      result.push(card);
      lastGpId = chosenBin.gpId;
    } else {
      runClientUnscoped(clientLog("error", `[activeSessionStore] Step ${step}: chosenBin is invalid or has no cards. Breaking.`));
      break;
    }
    step++;
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