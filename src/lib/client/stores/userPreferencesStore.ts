import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { Effect } from "effect";
import { computed } from "@preact/signals-core";
import { enqueueTransaction } from "../sync/OutboxQueue.ts";
import { runClientPromise } from "../runtime.ts";

export interface UserPreferences {
  readonly id: "settings";
  readonly dailyReviewLimit: number;
  readonly dailyNewRuleLimit: number;
}

const basePreferencesStore = createLocalStore<UserPreferences>("user_preferences");

export const userPreferencesStore = {
  ...basePreferencesStore,

  /**
   * Hydrates the local preference store, initializing it with defaults if not present.
   */
    load: () => {
    const effect = Effect.gen(function* () {
      yield* basePreferencesStore.load();
      const current = basePreferencesStore.state.peek();
      if (current.length === 0) {
        yield* basePreferencesStore.put({
          id: "settings",
          dailyReviewLimit: 50,
          dailyNewRuleLimit: 5,
        });
      }
    });
    (effect as any).then = (onFulfilled: any, onRejected: any) => {
      return runClientPromise(effect).then(onFulfilled, onRejected);
    };
    return effect;
  },

  /**
   * Mutates local study limits and enqueues an outbox sync transaction.
   */
  updateLimits: (dailyReviewLimit: number, dailyNewRuleLimit: number) => {
    const effect = Effect.gen(function* () {
      const updated: UserPreferences = {
        id: "settings",
        dailyReviewLimit,
        dailyNewRuleLimit,
      };
      yield* basePreferencesStore.put(updated);
      yield* enqueueTransaction("update_preferences", {
        dailyReviewLimit,
        dailyNewRuleLimit,
      });
    });
    (effect as any).then = (onFulfilled: any, onRejected: any) => {
      return runClientPromise(effect).then(onFulfilled, onRejected);
    };
    return effect;
  },

  /**
   * Computed signals for individual settings
   */
  dailyReviewLimit: computed(() => {
    const record = basePreferencesStore.state.value.find((p) => p.id === "settings");
    return record ? record.dailyReviewLimit : 50;
  }),

  dailyNewRuleLimit: computed(() => {
    const record = basePreferencesStore.state.value.find((p) => p.id === "settings");
    return record ? record.dailyNewRuleLimit : 5;
  }),
};
