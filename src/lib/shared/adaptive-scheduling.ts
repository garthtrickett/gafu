import type { KnowledgePointKind, LearningState, ParticipationStatus } from "./adaptive-media.ts";

export const DEFAULT_DAILY_NEW_POINTS = 3;
export const HARD_DAILY_NEW_POINTS = 5;
export const MAX_UNSTABLE_RECENT_POINTS = 20;
export const FAILURE_BUFFER_MULTIPLIER = 1.25;

export interface CapacityCandidate {
  readonly kind: KnowledgePointKind;
  readonly difficulty: number;
}

export const projectedSevenDayCost = ({ kind, difficulty }: CapacityCandidate): number => {
  const base = kind === "grammar" ? 2 : 1;
  const difficultyPremium = difficulty >= 7 ? 1 : 0;
  return Math.ceil((base + difficultyPremium) * FAILURE_BUFFER_MULTIPLIER);
};

export interface CapacitySnapshot {
  readonly admittedToday: number;
  readonly projectedCostToday: number;
  readonly unstableRecentCount: number;
  readonly preferredDailyLimit?: number;
  readonly matureBacklogCount: number;
}

export interface CapacityDecision {
  readonly allowed: boolean;
  readonly remainingPointSlots: number;
  readonly reason: "available" | "daily_limit" | "unstable_pool" | "mature_backlog";
}

export const previewIntroductionCapacity = (
  snapshot: CapacitySnapshot,
  candidate: CapacityCandidate,
): CapacityDecision => {
  const dailyLimit = Math.min(
    HARD_DAILY_NEW_POINTS,
    Math.max(0, snapshot.preferredDailyLimit ?? DEFAULT_DAILY_NEW_POINTS),
  );
  const remainingPointSlots = Math.max(0, dailyLimit - snapshot.admittedToday);
  if (remainingPointSlots === 0) return { allowed: false, remainingPointSlots, reason: "daily_limit" };
  if (snapshot.unstableRecentCount >= MAX_UNSTABLE_RECENT_POINTS) {
    return { allowed: false, remainingPointSlots, reason: "unstable_pool" };
  }
  // A mature backlog blocks new admissions once its due count exceeds the
  // learner's review budget; it never changes the order of already primed work.
  if (snapshot.matureBacklogCount > Math.max(1, dailyLimit * 3)) {
    return { allowed: false, remainingPointSlots, reason: "mature_backlog" };
  }
  const costBudget = dailyLimit * projectedSevenDayCost({ kind: "grammar", difficulty: 7 });
  if (snapshot.projectedCostToday + projectedSevenDayCost(candidate) > costBudget) {
    return { allowed: false, remainingPointSlots, reason: "daily_limit" };
  }
  return { allowed: true, remainingPointSlots, reason: "available" };
};

export interface QueueItem {
  readonly knowledgePointId: string;
  readonly participationStatus: ParticipationStatus;
  readonly learningState: LearningState;
  readonly introducedAt: string | null;
  readonly nextReview: string;
  readonly checkoutDue: boolean;
  readonly risk: number;
}

const MS_PER_DAY = 86_400_000;

export const queuePriority = (item: QueueItem, nowMs: number): number => {
  if (item.participationStatus === "archived" || item.learningState === "known") return 99;
  if (item.checkoutDue) return 0;
  const introducedAt = item.introducedAt ? new Date(item.introducedAt).getTime() : Number.NEGATIVE_INFINITY;
  if (introducedAt >= nowMs - 7 * MS_PER_DAY) return 1;
  const nextReview = new Date(item.nextReview).getTime();
  if (nextReview <= nowMs && item.risk >= 0.5) return 2;
  if (nextReview <= nowMs) return 3;
  return 4;
};

export const orderReviewQueue = (items: readonly QueueItem[], now: Date): QueueItem[] =>
  [...items]
    .filter((item) => queuePriority(item, now.getTime()) < 99)
    .sort((left, right) => {
      const priorityDifference = queuePriority(left, now.getTime()) - queuePriority(right, now.getTime());
      if (priorityDifference !== 0) return priorityDifference;
      return new Date(left.nextReview).getTime() - new Date(right.nextReview).getTime();
    });

export const learnerDayKey = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
