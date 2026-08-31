import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { db } from "./client.ts";
import { seedDb } from "./seed.ts";
import { graduateAllKnowledgePoints } from "./graduate-all-progress.ts";

describe("graduate-all progress command", () => {
  it("graduates every active point for only the selected learner and rotates the sync epoch", async () => {
    await Effect.runPromise(seedDb({ clearData: true }));
    const epochBefore = await db.selectFrom("sync_epoch").select("id").executeTakeFirstOrThrow();
    const activePointCount = await db.selectFrom("knowledge_point")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("catalogue_status", "=", "active")
      .executeTakeFirstOrThrow();

    const result = await Effect.runPromise(
      graduateAllKnowledgePoints("LEARNER@SITE.COM", new Date("2026-08-31T12:00:00.000Z")),
    );

    const learner = await db.selectFrom("user")
      .select("id")
      .where("email", "=", "learner@site.com")
      .executeTakeFirstOrThrow();
    const curator = await db.selectFrom("user")
      .select("id")
      .where("email", "=", "curator@site.com")
      .executeTakeFirstOrThrow();
    const learnerRows = await db.selectFrom("srs_card")
      .selectAll()
      .where("user_id", "=", learner.id)
      .execute();
    const curatorRows = await db.selectFrom("srs_card")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("user_id", "=", curator.id)
      .executeTakeFirstOrThrow();
    const epochAfter = await db.selectFrom("sync_epoch").select("id").executeTakeFirstOrThrow();

    expect(result.graduatedCount).toBe(Number(activePointCount.count));
    expect(learnerRows).toHaveLength(Number(activePointCount.count));
    expect(learnerRows.every((row) =>
      row.repetitions === 3 &&
      row.stability === 30 &&
      row.learning_state === "stable" &&
      row.participation_status === "active" &&
      row.checkout_due === false
    )).toBe(true);
    expect(Number(curatorRows.count)).toBe(0);
    expect(epochAfter.id).not.toBe(epochBefore.id);

    const missingLearnerResult = await Effect.runPromise(
      Effect.either(graduateAllKnowledgePoints("missing@site.com")),
    );
    expect(missingLearnerResult._tag).toBe("Left");
    const epochAfterRejectedAttempt = await db.selectFrom("sync_epoch").select("id").executeTakeFirstOrThrow();
    expect(epochAfterRejectedAttempt.id).toBe(epochAfter.id);
  });
});
