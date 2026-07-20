import { Effect } from "effect";
import { describe, it, expect, beforeEach } from "vitest";
import { activeSessionStore, weaveSessionCards, type SessionCard } from "./activeSessionStore.ts";
import {
  importSessionPayload,
  type SessionAudioEnricher,
} from "./sessionSyncStore.ts";
import { runClientPromise } from "../runtime.ts";

const successfulAudioEnricher: SessionAudioEnricher = {
  enrich: (items) =>
    Effect.succeed({
      items: items.map((item) => ({
        requestId: item.requestId,
        audioUrl: `https://media.example.test/${item.requestId}.mp3`,
      })),
      requestedCount: items.length,
      enrichedCount: items.length,
      failedCount: 0,
    }),
};

const createMockCard = (grammarPointId: string, index: number): SessionCard => ({
  grammarPointId,
  englishContext: `Context for ${grammarPointId} #${index}`,
  japaneseSentence: `Sentence for ${grammarPointId} #${index}`,
  furigana: [{ kanji: `Kanji ${grammarPointId}` }],
  audioUrl: null,
  explanation: "Explanation",
});

describe("activeSessionStore & weaveSessionCards unit tests", () => {
  beforeEach(() => {
    activeSessionStore.clear();
  });

  it("should handle empty inputs gracefully by resetting state", () => {
    activeSessionStore.loadSession([]);
    expect(activeSessionStore.masterList.value).toEqual([]);
    expect(activeSessionStore.state.value).toEqual([]);
    expect(activeSessionStore.currentIndex.value).toBe(0);
  });

  it("should preserve all cards and handle unique IDs without duplicates", () => {
    const cards = [
      createMockCard("A", 1),
      createMockCard("B", 1),
      createMockCard("C", 1),
      createMockCard("D", 1),
    ];
    const weaved = weaveSessionCards(cards);
    expect(weaved).toHaveLength(4);

    const originalIds = cards.map((c) => c.grammarPointId).sort();
    const weavedIds = weaved.map((c) => c.grammarPointId).sort();
    expect(weavedIds).toEqual(originalIds);
  });

  it("should prevent adjacent identical grammar points when duplicate counts are balanced", () => {
    const cards = [
      createMockCard("A", 1),
      createMockCard("A", 2),
      createMockCard("B", 1),
      createMockCard("B", 2),
      createMockCard("C", 1),
      createMockCard("C", 2),
    ];
    const weaved = weaveSessionCards(cards);
    expect(weaved).toHaveLength(6);

    for (let i = 0; i < weaved.length - 1; i++) {
      const current = weaved[i]?.grammarPointId;
      const next = weaved[i + 1]?.grammarPointId;
      expect(current).not.toBe(next);
    }
  });

  it("should prevent adjacent duplicates even in unbalanced scenarios where one ID is dominant", () => {
    const cards = [
      createMockCard("A", 1),
      createMockCard("A", 2),
      createMockCard("A", 3),
      createMockCard("B", 1),
      createMockCard("C", 1),
    ];
    const weaved = weaveSessionCards(cards);
    expect(weaved).toHaveLength(5);

    for (let i = 0; i < weaved.length - 1; i++) {
      const current = weaved[i]?.grammarPointId;
      const next = weaved[i + 1]?.grammarPointId;
      expect(current).not.toBe(next);
    }
  });

  it("should correctly cap and slice a large imported study load into a 15-card active batch", () => {
    const cards: SessionCard[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        cards.push(createMockCard(`GP-${i}`, j));
      }
    }
    expect(cards).toHaveLength(25);

    activeSessionStore.loadSession(cards);

    expect(activeSessionStore.masterList.value).toHaveLength(20);
    expect(activeSessionStore.state.value).toHaveLength(15);
    expect(activeSessionStore.batchIndex.value).toBe(0);
    expect(activeSessionStore.hasMoreBatches.value).toBe(true);
    expect(activeSessionStore.isFinished.value).toBe(false);
  });

  it("should handle sequential advancement and batch progression correctly", () => {
    const cards: SessionCard[] = [];
    for (let i = 0; i < 20; i++) {
      cards.push(createMockCard(`GP-${i % 5}`, i));
    }
    activeSessionStore.loadSession(cards);
    expect(activeSessionStore.state.value).toHaveLength(15);

    for (let i = 0; i < 15; i++) {
      expect(activeSessionStore.isFinished.value).toBe(false);
      activeSessionStore.next();
    }

    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.hasMoreBatches.value).toBe(true);

    activeSessionStore.startNextBatch();

    expect(activeSessionStore.batchIndex.value).toBe(1);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.state.value).toHaveLength(5);
    expect(activeSessionStore.isFinished.value).toBe(false);
    expect(activeSessionStore.hasMoreBatches.value).toBe(false);
  });

    it("should clear state correctly", () => {
    const cards = [
      createMockCard("A", 1),
      createMockCard("B", 1)
    ];
    activeSessionStore.loadSession(cards);
    expect(activeSessionStore.masterList.value).toHaveLength(2);

    activeSessionStore.clear();
    expect(activeSessionStore.masterList.value).toEqual([]);
    expect(activeSessionStore.state.value).toEqual([]);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.batchIndex.value).toBe(0);
  });

  it("should successfully persist and hydrate the session state from IndexedDB", async () => {
    const cards = [
      createMockCard("A", 1),
      createMockCard("B", 1)
    ];
    activeSessionStore.loadSession(cards);

    // Wait briefly for asynchronous background storage operation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Manually clear the in-memory state to test hydration
    activeSessionStore.state.value = [];
    activeSessionStore.masterList.value = [];
    activeSessionStore.currentIndex.value = 0;
    activeSessionStore.batchIndex.value = 0;

    // Hydrate state from IndexedDB
    await runClientPromise(activeSessionStore.load());

    expect(activeSessionStore.masterList.value).toHaveLength(2);
    expect(activeSessionStore.state.value).toHaveLength(2);
  });

  it("should successfully integrate with importSessionPayload to parse, activate, and weave cards", async () => {
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "GP-1",
          english_context: "Some context 1",
          japanese_sentence: "Sentence 1",
          explanation: "Explanation 1",
          hlc: "0000000000000:0000:initial"
        },
        {
          grammar_point_id: "GP-1",
          english_context: "Some context 2",
          japanese_sentence: "Sentence 2",
          explanation: "Explanation 2",
          hlc: "0000000000000:0000:initial"
        },
        {
          grammar_point_id: "GP-2",
          english_context: "Some context 3",
          japanese_sentence: "Sentence 3",
          explanation: "Explanation 3",
          hlc: "0000000000000:0000:initial"
        }
      ]
    };

    const jsonString = JSON.stringify(mockPayload);

    await runClientPromise(
      importSessionPayload(jsonString, {
        audioEnricher: successfulAudioEnricher,
      }),
    );

    const masterList = activeSessionStore.masterList.value;
    expect(masterList).toHaveLength(3);

    expect(masterList[0]?.grammarPointId).not.toBe(masterList[1]?.grammarPointId);
    expect(masterList[1]?.grammarPointId).not.toBe(masterList[2]?.grammarPointId);
  });

it("stores and dismisses the imported-session audio warning", () => {
  const cards = [
    createMockCard("A", 1),
    createMockCard("B", 1),
  ];

  activeSessionStore.loadSession(cards, {
    audioWarning: {
      missingCount: 1,
      totalCount: 2,
    },
  });

  expect(activeSessionStore.audioWarning.value).toEqual({
    missingCount: 1,
    totalCount: 2,
  });

  activeSessionStore.dismissAudioWarning();

  expect(activeSessionStore.audioWarning.value).toBeNull();
});

});
