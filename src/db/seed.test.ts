import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { seedDb } from "./seed";
import { db } from "./client";

describe("Database Seeder", () => {
  it("should seed all grammar points into the catalog but only 10 active srs cards", async () => {
    // Run the exported seedDb effect directly on our worker-isolated test database
    await Effect.runPromise(seedDb());

    // Verify the total seeded grammar points
    const gpCountResult = await db
      .selectFrom("grammar_point")
      .select(db.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();

    // Verify the total seeded active reviews
    const srsCountResult = await db
      .selectFrom("srs_card")
      .select(db.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();

    // All 250+ grammar points should exist in the catalog
    expect(Number(gpCountResult.count)).toBeGreaterThanOrEqual(250);

    // Exactly 10 srs cards should be registered to prevent Day 1 cognitive fatigue
    expect(Number(srsCountResult.count)).toBe(10);
  });
});
