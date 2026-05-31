import { describe, it, expect, beforeEach } from "vitest";
import { userPreferencesStore } from "./userPreferencesStore.ts";
import { runClientPromise } from "../runtime.ts";

describe("userPreferencesStore Default Fallbacks", () => {
    beforeEach(async () => {
    // Clear out the state to simulate a fresh, offline-first load
    await runClientPromise(userPreferencesStore.clear());
  });

  it("should fall back to a daily review limit of 20 and daily new rule limit of 3 when uninitialized", () => {
    expect(userPreferencesStore.dailyReviewLimit.value).toBe(20);
    expect(userPreferencesStore.dailyNewRuleLimit.value).toBe(3);
  });

    it("should initialize settings store with 20 and 3 on first load if settings are empty", async () => {
    await runClientPromise(userPreferencesStore.load());
    expect(userPreferencesStore.dailyReviewLimit.value).toBe(20);
    expect(userPreferencesStore.dailyNewRuleLimit.value).toBe(3);
  });
});
