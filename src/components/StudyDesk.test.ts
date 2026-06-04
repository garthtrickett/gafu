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

    // Verify progression export button is locked while gate is active
    const progressBtn = document.querySelector("#btn-export-progress") as HTMLButtonElement;
    expect(progressBtn).not.toBeNull();
    expect(progressBtn.disabled).toBe(true);
    expect(progressBtn.textContent).toContain("Progression Locked");

    // 4. Toggle the gate preference switch off
    const toggle = document.querySelector("#enforce-gates-toggle") as HTMLInputElement;
    expect(toggle).not.toBeNull();
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    // @ts-ignore
    await desk.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 50));

    // Mastery Gate alert should be hidden immediately
    htmlContent = document.body.innerHTML;
    expect(htmlContent).not.toContain("id=\"mastery-gate-alert\"");
    expect(htmlContent).not.toContain("id=\"backlog-advice-hint\"");

        // Verify progression export button is unlocked after gate is bypassed
    const progressBtnAfter = document.querySelector("#btn-export-progress") as HTMLButtonElement;
    expect(progressBtnAfter).not.toBeNull();
    expect(progressBtnAfter.disabled).toBe(false);
    expect(progressBtnAfter.textContent).toContain("Copy Progress Payload");
  });

  it("should render the metrics panel with exact calculations and distributions", async () => {
    // 1. Seed catalog with 3 rules
    await runClientPromise(
      grammarPointCatalogStore.putAll([
        { id: "gp-1", formal_name: "だ", base_meaning: "Is", difficulty_level: "N5" },
        { id: "gp-2", formal_name: "です", base_meaning: "Is (polite)", difficulty_level: "N5" },
        { id: "gp-3", formal_name: "は", base_meaning: "Topic", difficulty_level: "N5" },
      ])
    );

    // 2. Seed progress with 1 studied rule (learning) and 1 graduated rule
    const now = Date.now();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-1", easeFactor: 2.5, repetitions: 1, intervalDays: 1, difficulty: 7.5, stability: 1.0, lastReviewedAt: new Date(now).toISOString(), nextReview: new Date().toISOString() },
        { id: "gp-2", easeFactor: 2.5, repetitions: 4, intervalDays: 21, difficulty: 4.5, stability: 21.0, lastReviewedAt: new Date(now).toISOString(), nextReview: new Date().toISOString() },
      ])
    );

    const desk = document.createElement("study-desk");
    document.body.appendChild(desk);
    await new Promise(resolve => setTimeout(resolve, 50));

    const htmlContent = document.body.innerHTML;
    expect(htmlContent).toContain("id=\"metrics-panel\"");
    expect(htmlContent).toContain("id=\"retention-rate\"");
    expect(htmlContent).toContain("100%"); 

    expect(htmlContent).toContain("id=\"avg-difficulty\"");
    expect(htmlContent).toContain("6.0"); 

    expect(htmlContent).toContain("id=\"count-unstarted\"");
    expect(document.querySelector("#count-unstarted")?.textContent).toBe("1");
    expect(document.querySelector("#count-learning")?.textContent).toBe("1");
    expect(document.querySelector("#count-mastered")?.textContent).toBe("0");
    expect(document.querySelector("#count-graduated")?.textContent).toBe("1");
  });
});
