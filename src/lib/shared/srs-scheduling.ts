export interface SrsMetricsInput {
  readonly easeFactor?: number;
  readonly repetitions?: number;
  readonly intervalDays?: number;
  readonly difficulty?: number;
  readonly stability?: number;
}

export interface SrsMetricsUpdate {
  readonly easeFactor: number;
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly difficulty: number;
  readonly stability: number;
  readonly lastReviewedAt: string;
  readonly nextReview: string;
}

export const UNVARIED_MASTERY_INTERVAL_CAP_DAYS = 3;

export const applyVariationMasteryLimit = (
  update: SrsMetricsUpdate,
  successfulMaterialContextCount: number,
  now: Date,
): SrsMetricsUpdate => {
  if (successfulMaterialContextCount >= 2 || update.intervalDays <= UNVARIED_MASTERY_INTERVAL_CAP_DAYS) return update;
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + UNVARIED_MASTERY_INTERVAL_CAP_DAYS);
  return {
    ...update,
    intervalDays: UNVARIED_MASTERY_INTERVAL_CAP_DAYS,
    stability: Math.min(update.stability, UNVARIED_MASTERY_INTERVAL_CAP_DAYS),
    nextReview: nextReview.toISOString(),
  };
};

export const calculateSrsUpdate = (
  current: SrsMetricsInput,
  isCorrect: boolean,
  now = new Date(),
  random = Math.random,
): SrsMetricsUpdate => {
  const difficulty = current.difficulty ?? 5;
  const stability = current.stability ?? 0;
  const repetitions = current.repetitions ?? 0;
  const nextDifficulty = isCorrect ? Math.max(1, difficulty - 0.5) : Math.min(10, difficulty + 1.5);
  const nextStability = isCorrect
    ? repetitions === 0 || stability === 0 ? 1 : stability * Math.max(1.2, 3.5 - 0.2 * difficulty)
    : stability >= 7 ? Math.max(1, stability * 0.25) : 0.5;
  let intervalDays = Math.ceil(nextStability);
  if (intervalDays >= 5) intervalDays = Math.max(1, Math.round(intervalDays * (1 + (random() * 0.1 - 0.05))));
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + intervalDays);
  return {
    easeFactor: Math.round(Math.max(1.3, 3.5 - 0.2 * nextDifficulty) * 100) / 100,
    repetitions: isCorrect ? repetitions + 1 : 0,
    intervalDays,
    difficulty: Math.round(nextDifficulty * 100) / 100,
    stability: Math.round(nextStability * 100) / 100,
    lastReviewedAt: now.toISOString(),
    nextReview: nextReview.toISOString(),
  };
};
