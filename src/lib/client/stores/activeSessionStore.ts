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
  readonly knowledgePointId: string;
  readonly exerciseId?: string;
  readonly englishContext: string;
  readonly japaneseSentence: string;
  readonly furigana: readonly FuriganaSegment[];
  readonly audioUrl?: string | null;
  readonly explanation?: string;
}

export interface SessionAudioWarning {
  readonly missingCount: number;
  readonly totalCount: number;
}

export interface LoadSessionOptions {
  readonly audioWarning?: SessionAudioWarning | null;
}

const BATCH_SIZE = 15;
const SESSION_STORE = createStore("bedrock-lang-session-v1", "session");
const SESSION_KEY = "active_session_state";

const masterList = signal<readonly SessionCard[]>([]);
const state = signal<readonly SessionCard[]>([]);
const currentIndex = signal<number>(0);
const batchIndex = signal<number>(0);
const audioWarning = signal<SessionAudioWarning | null>(null);

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
            audioWarning: audioWarning.peek(),
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

  // Group cards by knowledgePointId
  const bins: Record<string, SessionCard[]> = {};
  for (const card of cards) {
    if (!bins[card.knowledgePointId]) {
      bins[card.knowledgePointId] = [];
    }
    bins[card.knowledgePointId]!.push(card);
  }

  runClientUnscoped(clientLog("info", `[activeSessionStore] Grouped cards into ${Object.keys(bins).length} unique knowledge-point bins.`));

  // Shuffle cards within each bin initially
  for (const pointId of Object.keys(bins)) {
    bins[pointId] = bins[pointId]!.sort(() => Math.random() - 0.5);
  }

  interface Bin {
    pointId: string;
    cards: SessionCard[];
  }

  const activeBins: Bin[] = Object.entries(bins).map(([pointId, binCards]) => ({
    pointId,
    cards: binCards,
  }));

  activeBins.forEach(b => {
    runClientUnscoped(clientLog("info", `[activeSessionStore] Bin pointId=${b.pointId} has ${b.cards.length} cards.`));
  });

  const result: SessionCard[] = [];
  let lastPointId: string | null = null;
  let step = 1;

  while (true) {
    const binsWithCards = activeBins.filter(b => b.cards.length > 0);
    if (binsWithCards.length === 0) {
      runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: No more cards left in any bins. Ending weave loop.`));
      break;
    }

    const allowedBins = binsWithCards.filter(b => b.pointId !== lastPointId);
    runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: lastPointId=${lastPointId}. Bins with cards: ${binsWithCards.map(b => `${b.pointId}(${b.cards.length})`).join(", ")}`));

    let chosenBin: Bin | undefined;

    if (allowedBins.length > 0) {
      const maxCount = Math.max(...allowedBins.map(b => b.cards.length));
      const candidates = allowedBins.filter(b => b.cards.length === maxCount);
      chosenBin = candidates[Math.floor(Math.random() * candidates.length)]!;
      runClientUnscoped(clientLog("info", `[activeSessionStore] Step ${step}: Selected ${chosenBin.pointId} from allowed candidates: ${candidates.map(b => b.pointId).join(", ")}`));
    } else {
      chosenBin = binsWithCards[0]!;
      runClientUnscoped(clientLog("warn", `[activeSessionStore] Step ${step}: Forced to select adjacent duplicate of lastPointId=${lastPointId} from bin ${chosenBin.pointId}`));
    }

    if (chosenBin && chosenBin.cards.length > 0) {
      const card = chosenBin.cards.shift()!;
      result.push(card);
      lastPointId = chosenBin.pointId;
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
  audioWarning,
  
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
            audioWarning?: SessionAudioWarning | null;
          }>(SESSION_KEY, SESSION_STORE),
        catch: (e) => new Error(`Failed to load active session state: ${String(e)}`),
      });

      if (cached) {
        masterList.value = cached.masterList;
        state.value = cached.state;
        currentIndex.value = cached.currentIndex;
        batchIndex.value = cached.batchIndex;
        audioWarning.value = cached.audioWarning ?? null;
        yield* clientLog(
          "info",
          `[activeSessionStore] Session state successfully hydrated. currentIndex: ${cached.currentIndex}, state.length: ${cached.state.length}`
        );
      } else {
        yield* clientLog("debug", "[activeSessionStore] No cached active session state found.");
      }
    }),
  
  loadSession: (
    cards: readonly SessionCard[],
    options: LoadSessionOptions = {},
  ) => {
    const weaved = weaveSessionCards(cards);
    const limit = userPreferencesStore.dailyReviewLimit.value;
    const cappedCards = weaved.slice(0, limit);
    masterList.value = cappedCards;
    batchIndex.value = 0;
    state.value = cappedCards.slice(0, BATCH_SIZE);
    currentIndex.value = 0;
    audioWarning.value = options.audioWarning ?? null;
    if (audioWarning.value) {
      runClientUnscoped(
        clientLog(
          "warn",
          `[activeSessionStore] Session loaded with ${audioWarning.value.missingCount} of ${audioWarning.value.totalCount} cards missing audio.`,
        ),
      );
    }
    triggerSave();
  },

  dismissAudioWarning: () => {
    audioWarning.value = null;
    runClientUnscoped(
      clientLog(
        "info",
        "[activeSessionStore] Audio generation warning dismissed.",
      ),
    );
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
    audioWarning.value = null;
    runClientUnscoped(
      Effect.tryPromise({
        try: () => del(SESSION_KEY, SESSION_STORE),
        catch: () => undefined,
      })
    );
  }
};
