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
      difficulty: 5.0,
      stability: 24.0,
      lastReviewedAt: past,
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

  it("should conditionally render Mastery Gate, list unmastered rules, display backlog advice, and update on toggle", async () => {
    // 1. Seed catalog with 3 rules
    const catalogItems = [
      { id: "gp-1", formal_name: "だ", base_meaning: "Is", difficulty_level: "N5" },
      { id: "gp-2", formal_name: "です", base_meaning: "Is (polite)", difficulty_level: "N5" },
      { id: "gp-3", formal_name: "は", base_meaning: "Topic", difficulty_level: "N5" },
    ];
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

        // 2. Seed active learning progress below 80% threshold (0% mastery: 2 active learning rules, both 0 reps)
    const past = new Date(Date.now() - 10000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, difficulty: 5.0, stability: 0.0, lastReviewedAt: null, nextReview: past },
        { id: "gp-2", easeFactor: 2.5, repetitions: 0, intervalDays: 0, difficulty: 5.0, stability: 0.0, lastReviewedAt: null, nextReview: past },
      ])
    );

    // Set review cap to 1 so that gp-2 is pushed into the backlog
    const preferences = await import("../lib/client/stores/userPreferencesStore");
    await runClientPromise(preferences.userPreferencesStore.updateLimits(1, 3, true));

    // 3. Instantiate and append element
    const desk = document.createElement("study-desk");
    document.body.appendChild(desk);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify Mastery Gate Card and unmastered rules render correctly
    let htmlContent = document.body.innerHTML;
    expect(htmlContent).toContain("id=\"mastery-gate-alert\"");
    expect(htmlContent).toContain("だ");
    expect(htmlContent).toContain("です");
    expect(htmlContent).toContain("id=\"backlog-advice-hint\""); // backlog advice rendered since gp-2 is in backlog

    // 4. Toggle the gate preference switch off
    const toggle = document.querySelector("#enforce-gates-toggle") as HTMLInputElement;
    expect(toggle).not.toBeNull();
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Mastery Gate alert should be hidden immediately
    htmlContent = document.body.innerHTML;
    expect(htmlContent).not.toContain("id=\"mastery-gate-alert\"");
    expect(htmlContent).not.toContain("id=\"backlog-advice-hint\"");
  });
});
