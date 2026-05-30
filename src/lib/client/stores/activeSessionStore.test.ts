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
