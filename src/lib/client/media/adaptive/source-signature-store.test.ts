import { Effect } from "effect";
import { clear } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";
import { fallbackTokens } from "./tokenizer.ts";
import { parseSrt } from "./subtitles.ts";
import {
  buildSourceExclusionSignatures,
  enrichSourceSemanticSignatures,
  getOrCreateSourceSignatureKey,
  loadSourceExclusionSignatures,
  persistSourceExclusionSignatures,
} from "./source-signature-store.ts";
import { createStore } from "idb-keyval";

const privateStore = createStore("gafu-adaptive-media-private-v1", "source-signatures");

describe("device-local source signature storage", () => {
  beforeEach(() => clear(privateStore));

  it("persists only non-displayable signatures under a stable device key", async () => {
    const firstKey = await Effect.runPromise(getOrCreateSourceSignatureKey());
    expect(await Effect.runPromise(getOrCreateSourceSignatureKey())).toEqual(firstKey);
    const cue = { ...parseSrt("1\n00:00:01,000 --> 00:00:02,000\nsynthetic source", "track-private")[0]!, tokens: fallbackTokens("synthetic source") };
    const signatures = await Effect.runPromise(buildSourceExclusionSignatures([cue], firstKey));
    const enriched = await Effect.runPromise(enrichSourceSemanticSignatures([cue], signatures, () => Effect.succeed([Float32Array.of(0.2, -0.1, 0.8)])));
    await Effect.runPromise(persistSourceExclusionSignatures("track-private", enriched));
    const loaded = await Effect.runPromise(loadSourceExclusionSignatures("track-private"));
    expect(loaded?.exact.size).toBe(1);
    expect(loaded?.lexical).toHaveLength(1);
    expect(loaded?.semantic).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toContain("synthetic source");
  });
});
