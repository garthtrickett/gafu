import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeInMemoryTtsSynthesisBudget,
  TtsSynthesisBudgetError,
} from "./TtsSynthesisBudget.ts";

describe("TtsSynthesisBudget", () => {
  it("allows reservations up to the configured daily ceiling", async () => {
    const budget = makeInMemoryTtsSynthesisBudget(
      2,
      () => "2026-07-20",
    );

    const first = await Effect.runPromise(budget.reserve());
    const second = await Effect.runPromise(budget.reserve());

    expect(first.attemptedCount).toBe(1);
    expect(second.attemptedCount).toBe(2);
  });

  it("rejects synthesis after the daily ceiling is reached", async () => {
    const budget = makeInMemoryTtsSynthesisBudget(
      1,
      () => "2026-07-20",
    );

    await Effect.runPromise(budget.reserve());
    const result = await Effect.runPromise(
      Effect.either(budget.reserve()),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(
        TtsSynthesisBudgetError,
      );
      expect(result.left.kind).toBe("limit");
    }
  });

  it("resets the in-memory counter when the UTC date changes", async () => {
    let date = "2026-07-20";
    const budget = makeInMemoryTtsSynthesisBudget(
      1,
      () => date,
    );

    await Effect.runPromise(budget.reserve());
    date = "2026-07-21";
    const nextDay = await Effect.runPromise(budget.reserve());

    expect(nextDay.usageDate).toBe("2026-07-21");
    expect(nextDay.attemptedCount).toBe(1);
  });
});
