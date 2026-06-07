import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { seedDb } from "./seed";
import { db } from "./client";

describe("Database Seeder", () => {
  it("should preserve existing SRS progress cards when seedDb is executed with clearData set to false", async () => {
    // 1. Initial seed
    await Effect.runPromise(seedDb({ clearData: true }));

    // Create a mock active SRS card on a seeded grammar point
    const user = await db.selectFrom("user").select("id").limit(1).executeTakeFirstOrThrow();
    const sampleGp = await db.selectFrom("grammar_point")
      .select("id")
      .where("id", "not in", (qb) => 
        qb.selectFrom("srs_card")
          .select("grammar_point_id")
          .where("user_id", "=", user.id)
      )
      .limit(1)
      .executeTakeFirstOrThrow();
    const sampleDeck = await db.selectFrom("deck").select("id").limit(1).executeTakeFirstOrThrow();

    await db.insertInto("srs_card").values({
      id: "12345678-1234-1234-1234-1234567890ab" as any,
      user_id: user.id,
      grammar_point_id: sampleGp.id,
      ease_factor: 2.5,
      repetitions: 5,
      interval_days: 10,
      next_review: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }).execute();

    // 2. Trigger seeder again with clearData: false (simulating server-side self-healing startup check)
    await Effect.runPromise(seedDb({ clearData: false }));

    // Verify the mock card was NOT dropped by the seeder
    const card = await db.selectFrom("srs_card").selectAll().where("id", "=", "12345678-1234-1234-1234-1234567890ab" as any).executeTakeFirst();
    expect(card).toBeDefined();
    expect(card!.repetitions).toBe(5);
  });

  it("should seed all grammar points into the catalog but only 10 active srs cards", async () => {
    // Run the exported seedDb effect directly on our worker-isolated test database
    await Effect.runPromise(seedDb());

    // Verify the total seeded grammar points
    const gpCountResult = await db
      .selectFrom("grammar_point")
      .select(({ fn }) => fn.countAll().as("count"))
      .executeTakeFirstOrThrow();

    // Verify the total seeded active reviews
    const srsCountResult = await db
      .selectFrom("srs_card")
      .select(({ fn }) => fn.countAll().as("count"))
      .executeTakeFirstOrThrow();

    // All 250+ grammar points should exist in the catalog
    expect(Number(gpCountResult.count)).toBeGreaterThanOrEqual(250);

    // Exactly 10 srs cards should be registered to prevent Day 1 cognitive fatigue
    expect(Number(srsCountResult.count)).toBe(10);

    // Verify baseline HLC values exist on seeded records
    const sampleGp = await db.selectFrom("grammar_point").select("hlc").limit(1).executeTakeFirstOrThrow();
    expect(sampleGp.hlc).toBe("0000000000000:0000:initial");

    const sampleSrs = await db.selectFrom("srs_card").select("hlc").limit(1).executeTakeFirstOrThrow();
    expect(sampleSrs.hlc).toBe("0000000000000:0000:initial");
  });
});
