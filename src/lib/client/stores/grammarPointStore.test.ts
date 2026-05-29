import { describe, it, expect, beforeEach } from "vitest";
import { activeSessionStore, type SessionCard } from "./activeSessionStore";

describe("ActiveSessionStore - Signals & State", () => {
  beforeEach(() => {
    activeSessionStore.clear();
  });

  it("should initialize with an empty session state", () => {
    expect(activeSessionStore.state.value).toEqual([]);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.currentCard.value).toBeNull();
  });

  it("should load a study session correctly", () => {
    const mockCards: readonly SessionCard[] = [
      {
        grammarPointId: "gp_1",
        englishContext: "At a sushi bar expressing desire",
        japaneseSentence: "食べたい",
        furigana: []
      },
      {
        grammarPointId: "gp_2",
        englishContext: "Asking politely for water",
        japaneseSentence: "ください",
        furigana: []
      }
    ];

    activeSessionStore.loadSession(mockCards);

    expect(activeSessionStore.state.value).toHaveLength(2);
    expect(activeSessionStore.currentIndex.value).toBe(0);
    expect(activeSessionStore.isFinished.value).toBe(false);
    expect(activeSessionStore.currentCard.value).toEqual(mockCards[0]);
  });

  it("should advance indices and finish gracefully", () => {
    const mockCards: readonly SessionCard[] = [
      {
        grammarPointId: "gp_1",
        englishContext: "At a sushi bar",
        japaneseSentence: "食べたい",
        furigana: []
      },
      {
        grammarPointId: "gp_2",
        englishContext: "Asking politely",
        japaneseSentence: "ください",
        furigana: []
      }
    ];

    activeSessionStore.loadSession(mockCards);
    activeSessionStore.next();

    expect(activeSessionStore.currentIndex.value).toBe(1);
    expect(activeSessionStore.currentCard.value).toEqual(mockCards[1]);
    expect(activeSessionStore.isFinished.value).toBe(false);

    activeSessionStore.next();
    expect(activeSessionStore.isFinished.value).toBe(true);
    expect(activeSessionStore.currentCard.value).toBeNull();
  });
});