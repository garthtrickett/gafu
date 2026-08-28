import { Effect } from "effect";
import { clear, createStore } from "idb-keyval";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackTokens } from "./tokenizer.ts";
import { parseSrt } from "./subtitles.ts";
import {
  buildSourceExclusionSignatures,
  getOrCreateSourceSignatureKey,
  persistSourceExclusionSignatures,
} from "./source-signature-store.ts";
import { submitLearningEvent, validateGeneratedSentence } from "./learning-content.ts";

const privateStore = createStore("gafu-adaptive-media-private-v1", "source-signatures");

describe("learning content source exclusion boundary", () => {
  beforeEach(() => clear(privateStore));

  it("fails closed without the original device-local signatures", async () => {
    const result = await Effect.runPromise(Effect.either(validateGeneratedSentence(
      "別の例を試す。", 3, 5, [], "missing-track", () => Effect.succeed([Float32Array.of(1, 0, 0)]),
    )));
    expect(result).toMatchObject({ _tag: "Left" });
  });

  it("rejects an exact source line before it can become learner-facing", async () => {
    const text = "合成した字幕です。";
    const cue = { ...parseSrt(`1\n00:00:01,000 --> 00:00:02,000\n${text}`, "track-source")[0]!, tokens: fallbackTokens(text) };
    const key = await Effect.runPromise(getOrCreateSourceSignatureKey());
    const signatures = await Effect.runPromise(buildSourceExclusionSignatures([cue], key));
    await Effect.runPromise(persistSourceExclusionSignatures("track-source", signatures));
    const result = await Effect.runPromise(Effect.either(validateGeneratedSentence(
      text, 0, 2, [cue], "track-source", () => Effect.succeed([Float32Array.of(1, 0, 0)]),
      (sentence) => Effect.succeed(fallbackTokens(sentence)),
    )));
    expect(result).toMatchObject({ _tag: "Left" });
  });

  it("syncs encounter provenance without subtitle text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await Effect.runPromise(submitLearningEvent("token", {
      knowledgePointId: crypto.randomUUID(), candidateId: crypto.randomUUID(), event: "cue_reached",
      idempotencyKey: "cue-idempotent", encounter: { cueId: "cue-private", timingTransformId: "manual-v1", effectivePlaybackSeconds: 12 },
    }));
    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain("cue-private");
    expect(body).not.toContain("subtitle");
    fetchSpy.mockRestore();
  });
});
