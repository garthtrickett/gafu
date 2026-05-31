import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { Effect } from "effect";
import { computed } from "@preact/signals-core";
import { enqueueTransaction } from "../sync/OutboxQueue.ts";

export interface UserPreferences {
  readonly id: "settings";
  readonly dailyReviewLimit: number;
  readonly dailyNewRuleLimit: number;
  readonly enforceMasteryGates: boolean;
  readonly hlc?: string;
}

const basePreferencesStore = createLocalStore<UserPreferences>("user_preferences");

export const userPreferencesStore = {
  ...basePreferencesStore,

  load: () => {
    const effect = Effect.gen(function* () {
      yield* basePreferencesStore.load();
      const current = basePreferencesStore.state.peek();
            if (current.length === 0) {
        yield* basePreferencesStore.put({
          id: "settings",
          dailyReviewLimit: 20,
          dailyNewRuleLimit: 3,
          enforceMasteryGates: true,
        });
      } else {
        const settings = current.find((p) => p.id === "settings");
        if (settings && settings.enforceMasteryGates === undefined) {
          yield* basePreferencesStore.put({
            ...settings,
            enforceMasteryGates: true,
          });
        }
      }
    });
    return effect;
  },

    updateLimits: (dailyReviewLimit: number, dailyNewRuleLimit: number, enforceMasteryGates: boolean = true) => {
    const effect = Effect.gen(function* () {
      const updated: UserPreferences = {
        id: "settings",
        dailyReviewLimit,
        dailyNewRuleLimit,
        enforceMasteryGates,
      };
      yield* basePreferencesStore.put(updated);
      yield* enqueueTransaction("update_preferences", {
        dailyReviewLimit,
        dailyNewRuleLimit,
        enforceMasteryGates,
      });
    });
    return effect;
  },

  dailyReviewLimit: computed(() => {
    const record = basePreferencesStore.state.value.find((p) => p.id === "settings");
    return record ? record.dailyReviewLimit : 20;
  }),

    dailyNewRuleLimit: computed(() => {
    const record = basePreferencesStore.state.value.find((p) => p.id === "settings");
    return record ? record.dailyNewRuleLimit : 3;
  }),

  enforceMasteryGates: computed(() => {
    const record = basePreferencesStore.state.value.find((p) => p.id === "settings");
    return record && record.enforceMasteryGates !== undefined ? record.enforceMasteryGates : true;
  }),
};
