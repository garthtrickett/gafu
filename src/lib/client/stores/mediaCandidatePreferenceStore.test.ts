import { createStore, clear, get } from "idb-keyval";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { hlcStore } from "./hlcStore.ts";
import { mediaCandidatePreferenceStore, suppressedMediaCanonicalKeys } from "./mediaCandidatePreferenceStore.ts";

const outboxStore = createStore("bedrock-lang-outbox-v1", "outbox");

describe("media candidate preference store", () => {
  beforeEach(async () => {
    await clear(outboxStore);
    await Effect.runPromise(mediaCandidatePreferenceStore.clear());
    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());
  });

  it("persists canonical suppression locally and queues it for cross-device sync", async () => {
    await Effect.runPromise(mediaCandidatePreferenceStore.suppress("grammar", "grammar:〜わけではない"));

    expect(suppressedMediaCanonicalKeys()).toEqual(new Set(["grammar:〜わけではない"]));
    const keys = await get<string[]>("outbox_pending_keys", outboxStore);
    expect(keys).toHaveLength(1);
    const transaction = await get<{ type: string; payload: unknown }>(`tx:${keys![0]}`, outboxStore);
    expect(transaction).toMatchObject({
      type: "set_media_candidate_preference",
      payload: {
        kind: "grammar",
        canonicalKey: "grammar:〜わけではない",
        disposition: "not_useful",
      },
    });
  });

  it("rejects canonical keys that do not match their kind", async () => {
    const result = await Effect.runPromise(Effect.either(
      mediaCandidatePreferenceStore.suppress("grammar", "vocabulary:猫"),
    ));
    expect(result._tag).toBe("Left");
    expect(mediaCandidatePreferenceStore.state.peek()).toEqual([]);
  });
});
