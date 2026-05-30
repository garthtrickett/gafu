import { describe, it, expect } from "vitest";
import { activeSessionStore, type SessionCard } from "./activeSessionStore";

describe("activeSessionStore Capping & Batching", () => {
  const createMockCards = (count: number): SessionCard[] =>
    Array.from({ length: count }, (_, i) => ({
      grammarPointId: `gp-${i}`,
      englishContext: `English Context ${i}`,
      japaneseSentence: `Japanese Sentence ${i}`,
      furigana: []
    }));

  it("should correctly cap and slice a large imported study load into a 15-card active batch", () => {
    const mockCards = createMockCards(20);
    activeSessionStore.loadSession(mockCards);

    expect(activeSessionStore.masterList.value).toHaveLength(20);
    expect(activeSessionStore.state.value).toHaveLength(15);
    expect(activeSessionStore.batchIndex.value).toBe(0);
    expect(activeSessionStore.hasMoreBatches.value).toBe(true);
    expect(activeSessionStore.isFinished.value).toBe(false);
  });

  it("should handle sequential advancement and batch progression correctly", () => {
    const mockCards = createMockCards(20);
    activeSessionStore.loadSession(mockCards);

    // Verify we cannot advance beyond the first batch (15 items)
    for (let i = 0; i < 15; i++) {
      expect(activeSessionStore.isFinished.value).toBe(false);
      activeSessionStore.next();
    }

    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.hasMoreBatches.value).toBe(true);

    // Transition to the next batch
    activeSessionStore.startNextBatch();

    expect(activeSessionStore.batchIndex.value).toBe(1);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.state.value).toHaveLength(5); // Remaining 5 cards
    expect(activeSessionStore.isFinished.value).toBe(false);
    expect(activeSessionStore.hasMoreBatches.value).toBe(false);
  });
});
import { describe, it, expect, beforeEach } from "vitest";
import { activeSessionStore, weaveSessionCards, type SessionCard } from "./activeSessionStore.ts";
import { importSessionPayload } from "./sessionSyncStore.ts";
import { runClientPromise } from "../runtime.ts";

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

  it("should enforce the daily limit of 20 cards and populate state with BATCH_SIZE of 15", () => {
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
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.batchIndex.value).toBe(0);
    expect(activeSessionStore.hasMoreBatches.value).toBe(true);
  });

  it("should advance to next batch and clear state correctly", () => {
    const cards: SessionCard[] = [];
    for (let i = 0; i < 20; i++) {
      cards.push(createMockCard(`GP-${i % 5}`, i));
    }
    activeSessionStore.loadSession(cards);
    expect(activeSessionStore.state.value).toHaveLength(15);

    activeSessionStore.startNextBatch();
    expect(activeSessionStore.batchIndex.value).toBe(1);
    expect(activeSessionStore.state.value).toHaveLength(5);
    expect(activeSessionStore.currentIndex.value).toBe(0);

        activeSessionStore.clear();
    expect(activeSessionStore.masterList.value).toEqual([]);
    expect(activeSessionStore.state.value).toEqual([]);
  });

  it("should successfully integrate with importSessionPayload to parse, activate, and weave cards", async () => {
    // Mock JSON session payload with duplicate cards
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "GP-1",
          english_context: "Some context 1",
          japanese_sentence: "Sentence 1",
          explanation: "Explanation 1"
        },
        {
          grammar_point_id: "GP-1",
          english_context: "Some context 2",
          japanese_sentence: "Sentence 2",
          explanation: "Explanation 2"
        },
        {
          grammar_point_id: "GP-2",
          english_context: "Some context 3",
          japanese_sentence: "Sentence 3",
          explanation: "Explanation 3"
        }
      ]
    };

    const jsonString = JSON.stringify(mockPayload);

    // Run importSessionPayload through the client effect runtime
    await runClientPromise(importSessionPayload(jsonString));

    // After import, the masterList should have the cards weaved
    const masterList = activeSessionStore.masterList.value;
    expect(masterList).toHaveLength(3);

    // Verify GP-1 cards are not consecutive since GP-2 is interleaved between them
    expect(masterList[0]?.grammarPointId).not.toBe(masterList[1]?.grammarPointId);
    expect(masterList[1]?.grammarPointId).not.toBe(masterList[2]?.grammarPointId);
  });
});
