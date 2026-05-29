import { describe, it, expect } from "vitest";
import { enqueueTransaction } from "./OutboxQueue";
import { Effect } from "effect";

describe("OutboxQueue - Client Synchronization", () => {
  it("should successfully serialize and enqueue a record_review transaction with grammarPointId", async () => {
    const mockPayload = {
      grammarPointId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55",
      easeFactor: 2.65,
      repetitions: 1,
      intervalDays: 1,
      nextReview: new Date().toISOString()
    };

    const program = Effect.gen(function* () {
      yield* enqueueTransaction("record_review", mockPayload);
    });

    // Run within client runtime environment and verify it enqueues without error
    const result = await Effect.runPromise(program);
    expect(result).toBeUndefined();
  });
});