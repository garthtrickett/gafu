import { describe, it, expect, beforeEach } from "vitest";
import { runClientPromise } from "../lib/client/runtime.ts";
import { grammarPointStore, grammarPointCatalogStore } from "../lib/client/stores/grammarPointStore.ts";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore.ts";
import "./StudyDesk.ts";

describe("StudyDesk component and activeSessionStore pacing presentation", () => {
  beforeEach(async () => {
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(grammarPointCatalogStore.clear());
    activeSessionStore.clear();
    document.body.innerHTML = "";
  });

  it("should enforce a study cap of 20 in activeSessionStore when a large session payload is loaded", () => {
    // Construct a large mock session containing 35 cards
    const largeCards = Array.from({ length: 35 }, (_, i) => ({
      grammarPointId: `gp-${i}`,
      englishContext: `Context ${i}`,
      japaneseSentence: `Sentence ${i}`,
      furigana: [],
    }));

    activeSessionStore.loadSession(largeCards);

    // The active master list should be capped to 20, and batched correctly
    expect(activeSessionStore.masterList.value).toHaveLength(20);
    expect(activeSessionStore.state.value).toHaveLength(15); // first batch
  });

  it("should visually split due rules into 'Due Today' (max 20) and 'Snoozed Backlog' on StudyDesk", async () => {
    // 1. Seed catalog with 30 items
    const catalogItems = Array.from({ length: 30 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // 2. Seed progress with 30 due items (all in the past)
    const past = new Date(Date.now() - 10000).toISOString();
    const progressItems = Array.from({ length: 30 }, (_, i) => ({
      id: `gp-${i}`,
      easeFactor: 2.5,
      repetitions: 1,
      intervalDays: 1,
      nextReview: past,
    }));
    await runClientPromise(grammarPointStore.putAll(progressItems));

    // 3. Instantiate and append study-desk element
    const desk = document.createElement("study-desk");
    document.body.appendChild(desk);

    // Allow lit element to finish updating
    await new Promise(resolve => setTimeout(resolve, 100));

    // Manually toggle queue visibility so it renders the lists
    // @ts-ignore
    desk.showQueue = true;
    // @ts-ignore
    await desk.updateComplete;

    // 4. Assertions on the DOM:
    // Due Today section should have exactly 20 rules, backlog has 10
    const htmlContent = document.body.innerHTML;
    expect(htmlContent).toContain("Due Today - Daily Target (20 rules)");
    expect(htmlContent).toContain("Snoozed Backlog (10 rules)");
  });
});
