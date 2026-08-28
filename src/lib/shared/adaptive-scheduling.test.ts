import { describe, expect, it } from "vitest";
import {
  HARD_DAILY_NEW_POINTS,
  learnerDayKey,
  orderReviewQueue,
  previewIntroductionCapacity,
  projectedSevenDayCost,
  type QueueItem,
} from "./adaptive-scheduling.ts";

describe("adaptive scheduling capacity", () => {
  it("uses one bounded pool for grammar and vocabulary", () => {
    expect(projectedSevenDayCost({ kind: "grammar", difficulty: 8 })).toBeGreaterThan(
      projectedSevenDayCost({ kind: "vocabulary", difficulty: 3 }),
    );
    expect(previewIntroductionCapacity({
      admittedToday: HARD_DAILY_NEW_POINTS,
      projectedCostToday: 0,
      unstableRecentCount: 0,
      preferredDailyLimit: 100,
      matureBacklogCount: 0,
    }, { kind: "vocabulary", difficulty: 2 })).toMatchObject({ allowed: false, reason: "daily_limit" });
  });

  it("blocks admissions for an unstable pool or excessive mature backlog", () => {
    expect(previewIntroductionCapacity({
      admittedToday: 0, projectedCostToday: 0, unstableRecentCount: 20, matureBacklogCount: 0,
    }, { kind: "grammar", difficulty: 5 }).reason).toBe("unstable_pool");
    expect(previewIntroductionCapacity({
      admittedToday: 0, projectedCostToday: 0, unstableRecentCount: 0, matureBacklogCount: 10,
    }, { kind: "grammar", difficulty: 5 }).reason).toBe("mature_backlog");
  });

  it("orders checkout, recent introductions, mature due, then lower-risk overdue", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    const item = (id: string, values: Partial<QueueItem>): QueueItem => ({
      knowledgePointId: id,
      participationStatus: "active",
      learningState: "learning",
      introducedAt: "2026-08-01T00:00:00.000Z",
      nextReview: "2026-08-27T00:00:00.000Z",
      checkoutDue: false,
      risk: 0.7,
      ...values,
    });
    const ordered = orderReviewQueue([
      item("low", { risk: 0.2 }),
      item("recent", { introducedAt: "2026-08-26T00:00:00.000Z" }),
      item("checkout", { checkoutDue: true }),
      item("mature", {}),
      item("archived", { participationStatus: "archived" }),
    ], now);
    expect(ordered.map((entry) => entry.knowledgePointId)).toEqual(["checkout", "recent", "mature", "low"]);
  });

  it("derives the learner day from the stored IANA time zone", () => {
    const instant = new Date("2026-08-28T00:30:00.000Z");
    expect(learnerDayKey(instant, "UTC")).toBe("2026-08-28");
    expect(learnerDayKey(instant, "America/Los_Angeles")).toBe("2026-08-27");
  });
});
