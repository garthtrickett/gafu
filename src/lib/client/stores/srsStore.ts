import { createLocalStore } from "../storage/LocalStoreFactory";
import { Effect } from "effect";

export interface SrsCardClient {
  readonly id: string;
  readonly front: string;
  readonly back: string;
  readonly audioUrl?: string | null;
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly nextReview: string;
  readonly difficulty?: number;
  readonly stability?: number;
  readonly lastReviewedAt?: string | null;
  readonly hlc?: string;
}

const baseSrsStore = createLocalStore<SrsCardClient>("srs", (a, b) => 
  new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime()
);

export const srsStore = {
  ...baseSrsStore,
  load: () => {
    const effect = Effect.gen(function* () {
      yield* baseSrsStore.load();
      const current = baseSrsStore.state.peek();
      let needsWrite = false;
      const updatedList: SrsCardClient[] = [];

      for (const item of current) {
        if (
          item.difficulty === undefined ||
          item.stability === undefined ||
          (item.repetitions > 0 && item.stability === 0.0) ||
          (item.intervalDays > 0 && item.stability === 0.0) ||
          item.lastReviewedAt === undefined
        ) {
          needsWrite = true;
          const ease = item.easeFactor ?? 2.5;
          const calculatedDifficulty = Math.round(Math.max(1.0, Math.min(10.0, 5.0 + (2.5 - ease) * 4.0)) * 100) / 100;
          const calculatedStability = item.intervalDays ?? 0.0;
          
          let calculatedLastReviewed: string | null = item.lastReviewedAt ?? null;
          if (!calculatedLastReviewed && (item.repetitions > 0 || item.intervalDays > 0)) {
            const nextDate = new Date(item.nextReview);
            nextDate.setDate(nextDate.getDate() - item.intervalDays);
            calculatedLastReviewed = nextDate.toISOString();
          }

          updatedList.push({
            ...item,
            difficulty: calculatedDifficulty,
            stability: calculatedStability,
            lastReviewedAt: calculatedLastReviewed,
          });
        } else {
          updatedList.push(item);
        }
      }

      if (needsWrite) {
        yield* baseSrsStore.putAll(updatedList);
      }
    });
    return effect;
  }
};
