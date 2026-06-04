import { signal, computed } from "@preact/signals-core";
import { clientLog } from "../clientLog.ts";
import { runClientUnscoped } from "../runtime.ts";
import { userPreferencesStore } from "./userPreferencesStore.ts";
import { createStore, get, set, del } from "idb-keyval";
import { Effect } from "effect";

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
const SESSION_STORE = createStore("bedrock-lang-session-v1", "session");
const SESSION_KEY = "active_session_state";

const masterList = signal<readonly SessionCard[]>([]);
const state = signal<readonly SessionCard[]>([]);
const currentIndex = signal<number>(0);
const batchIndex = signal<number>(0);

const saveSessionState = () =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        set(
          SESSION_KEY,
          {
            masterList: masterList.peek(),
            state: state.peek(),
            currentIndex: currentIndex.peek(),
            batchIndex: batchIndex.peek(),
          },
          SESSION_STORE
        ),
      catch: (e) => new Error(`Failed to save active session state: ${String(e)}`),
    });
  });

const triggerSave = () => {
  runClientUnscoped(
    saveSessionState().pipe(
      Effect.catchAll((err) =>
        clientLog("error", "[activeSessionStore] Failed to save session state", err)
      )
    )
  );
};

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

  load: () =>
    Effect.gen(function* () {
      yield* clientLog("info", "[activeSessionStore] Hydrating session state from IndexedDB...");
      const cached = yield* Effect.tryPromise({
        try: () =>
          get<{
            masterList: readonly SessionCard[];
            state: readonly SessionCard[];
            currentIndex: number;
            batchIndex: number;
          }>(SESSION_KEY, SESSION_STORE),
        catch: (e) => new Error(`Failed to load active session state: ${String(e)}`),
      });

      if (cached) {
        masterList.value = cached.masterList;
        state.value = cached.state;
        currentIndex.value = cached.currentIndex;
        batchIndex.value = cached.batchIndex;
        yield* clientLog(
          "info",
          `[activeSessionStore] Session state successfully hydrated. currentIndex: ${cached.currentIndex}, state.length: ${cached.state.length}`
        );
      } else {
        yield* clientLog("debug", "[activeSessionStore] No cached active session state found.");
      }
    }),
  
  loadSession: (cards: readonly SessionCard[]) => {
    const weaved = weaveSessionCards(cards);
    const limit = userPreferencesStore.dailyReviewLimit.value;
    const cappedCards = weaved.slice(0, limit);
    masterList.value = cappedCards;
    batchIndex.value = 0;
    state.value = cappedCards.slice(0, BATCH_SIZE);
    currentIndex.value = 0;
    triggerSave();
  },
  
  startNextBatch: () => {
    const nextIndex = batchIndex.value + 1;
    const start = nextIndex * BATCH_SIZE;
    if (start < masterList.value.length) {
      batchIndex.value = nextIndex;
      state.value = masterList.value.slice(start, start + BATCH_SIZE);
      currentIndex.value = 0;
      triggerSave();
    }
  },
  
  next: () => {
    if (currentIndex.value < state.value.length) {
      currentIndex.value += 1;
      triggerSave();
    }
  },
  
  clear: () => {
    masterList.value = [];
    state.value = [];
    currentIndex.value = 0;
    batchIndex.value = 0;
    runClientUnscoped(
      Effect.tryPromise({
        try: () => del(SESSION_KEY, SESSION_STORE),
        catch: () => undefined,
      })
    );
  }
};
