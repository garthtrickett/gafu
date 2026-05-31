import { createStore, get, set, del } from "idb-keyval";
import { Effect, Queue, Stream, Schedule, Duration } from "effect";
import { isOnlineState } from "../stores/syncStore";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

const DB_NAME = "bedrock-lang-outbox-v1";
const STORE_NAME = "outbox";
const outboxDBStore = createStore(DB_NAME, STORE_NAME);
const OUTBOX_KEYS_LIST = "outbox_pending_keys";

export interface OutboxTransaction {
  readonly id: string;
  readonly type: "record_review" | "toggle_skin" | "unlock_deck" | "update_preferences";
  readonly payload: unknown;
  readonly hlc: string;
}

const transactionQueue = Effect.runSync(Queue.unbounded<string>());

const getPendingKeys = (): Promise<string[]> => {
  return get<string[]>(OUTBOX_KEYS_LIST, outboxDBStore).then((keys) => keys || []);
};

const savePendingKeys = (keys: string[]): Promise<void> => {
  return set(OUTBOX_KEYS_LIST, keys, outboxDBStore);
};

export const enqueueTransaction = (
  type: OutboxTransaction["type"],
  payload: unknown
) =>
  Effect.gen(function* () {
    const { hlcStore } = yield* Effect.promise(() => import("../stores/hlcStore.ts"));
    const currentHlc = yield* hlcStore.tick();

    const txId = crypto.randomUUID();
    const transaction: OutboxTransaction = {
      id: txId,
      type,
      payload,
      hlc: currentHlc,
    };

    yield* Effect.tryPromise({
      try: () => set(`tx:${txId}`, transaction, outboxDBStore),
      catch: (e) => new Error(`Failed to write outbox transaction: ${String(e)}`),
    });

    const keys = yield* Effect.tryPromise({
      try: () => getPendingKeys(),
      catch: (e) => e,
    });
    keys.push(txId);
    
    yield* Effect.tryPromise({
      try: () => savePendingKeys(keys),
      catch: (e) => e,
    });

    yield* clientLog("debug", `[Outbox] Enqueued transaction ${txId} (${type}) stamped with HLC ${currentHlc}`);
    yield* Queue.offer(transactionQueue, txId);
  });

const flushTransaction = (txId: string) =>
  Effect.gen(function* () {
    const transaction = yield* Effect.tryPromise({
      try: () => get<OutboxTransaction>(`tx:${txId}`, outboxDBStore),
      catch: (e) => new Error(`Failed to retrieve transaction ${txId}: ${String(e)}`),
    });

    if (!transaction) return;

    const token = localStorage.getItem("jwt");
    yield* clientLog("debug", `[Outbox] Retrieved token from localStorage for flush: "${token}"`);
    if (!token || token === "null" || token === "undefined" || token.trim() === "") {
      yield* clientLog("debug", `[Outbox] No valid active session. Skipping flush for transaction ${txId}.`);
      return;
    }

    yield* clientLog("info", `[Outbox] Flushing transaction ${txId} (${transaction.type})...`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/sync/push", {
          method: "POST",
          headers,
          body: JSON.stringify(transaction),
        }),
      catch: (e) => new Error(`Network failure during flush: ${String(e)}`),
    });

    if (!response.ok) {
      return yield* Effect.fail(new Error(`Server rejected transaction: ${response.status}`));
    }

    // Success: Delete local records
    yield* Effect.tryPromise({
      try: () => del(`tx:${txId}`, outboxDBStore),
      catch: (e) => e,
    });

    const keys = yield* Effect.tryPromise({
      try: () => getPendingKeys(),
      catch: (e) => e,
    });
    const updatedKeys = keys.filter((k) => k !== txId);
    
    yield* Effect.tryPromise({
      try: () => savePendingKeys(updatedKeys),
      catch: (e) => e,
    });

    yield* clientLog("info", `[Outbox] Successfully flushed transaction ${txId}`);
  });

const retrySchedule = Schedule.exponential("1 second", 2.0).pipe(
  Schedule.map((d) => Duration.min(d, Duration.minutes(2))),
  Schedule.jittered
);

const processQueueStream = Stream.fromQueue(transactionQueue).pipe(
  Stream.mapEffect(
    (txId) =>
      Effect.gen(function* () {
        if (!isOnlineState.value) {
          yield* clientLog("debug", "[Outbox] Network offline. Suspending flush queue.");
          return;
        }

        yield* flushTransaction(txId).pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: () => isOnlineState.value,
          })
        );
      }),
    { concurrency: 1 } // Enforce sequential processing to preserve SRS chronological validity
  ),
  Stream.runDrain
);

export const startOutboxService = () => {
  const initEffect = Effect.gen(function* () {
    yield* clientLog("info", "[Outbox] Initializing outbox queue...");
    const keys = yield* Effect.tryPromise({
      try: () => getPendingKeys(),
      catch: (e) => new Error(`Failed to load outbox keys: ${String(e)}`),
    });

    if (keys.length > 0) {
      yield* clientLog("info", `[Outbox] Resuming ${keys.length} pending transactions...`);
      for (const key of keys) {
        yield* Queue.offer(transactionQueue, key);
      }
    }

    yield* Effect.forkDaemon(processQueueStream);
  });

  runClientUnscoped(
    initEffect.pipe(
      Effect.catchAll((err) =>
        clientLog("error", "[Outbox] Service failed initialization", err)
      )
    )
  );
};
