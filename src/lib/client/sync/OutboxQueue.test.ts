import { describe, it, expect, beforeEach } from "vitest";
import { enqueueTransaction } from "./OutboxQueue";
import { Effect } from "effect";
import { createStore, get, clear } from "idb-keyval";
import { hlcStore } from "../stores/hlcStore";

const outboxDBStore = createStore("bedrock-lang-outbox-v1", "outbox");

describe("OutboxQueue - Client Synchronization", () => {
  beforeEach(async () => {
    await clear(outboxDBStore);
    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());
  });

  it("should successfully serialize and enqueue a record_review transaction with a structurally valid HLC string", async () => {
    const mockPayload = {
      knowledgePointId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55",
      easeFactor: 2.65,
      repetitions: 1,
      intervalDays: 1,
      nextReview: new Date().toISOString()
    };

    const program = Effect.gen(function* () {
      yield* enqueueTransaction("record_review", mockPayload);
    });

    await Effect.runPromise(program);

    // Retrieve enqueued transaction from IndexedDB
    const keys = await get<string[]>("outbox_pending_keys", outboxDBStore);
    expect(keys).toBeDefined();
    expect(keys!.length).toBe(1);

    const txId = keys![0];
    const tx = await get<any>(`tx:${txId}`, outboxDBStore);
    expect(tx).toBeDefined();
    expect(tx.id).toBe(txId);
    expect(tx.type).toBe("record_review");
    expect(tx.payload).toEqual(mockPayload);
    
    // Assert structurally valid HLC string (timestamp:counter:nodeId)
    expect(tx.hlc).toBeDefined();
    expect(typeof tx.hlc).toBe("string");
    
    const parts = tx.hlc.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toMatch(/^\d{13}$/); // padded physical timestamp
    expect(parts[1]).toMatch(/^[0-9a-f]{4}$/); // padded hex counter
    expect(parts[2]).toBeDefined(); // nodeId (UUID)
  });
});
