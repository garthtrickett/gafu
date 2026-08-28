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
import { fetchNextValidatedExercise, submitLearningEvent, validateGeneratedSentence } from "./learning-content.ts";

const privateStore = createStore("gafu-adaptive-media-private-v1", "source-signatures");
const exerciseCache = createStore("gafu-adaptive-exercise-cache-v1", "validated-exercises");

describe("learning content source exclusion boundary", () => {
  beforeEach(async () => {
    await clear(privateStore);
    await clear(exerciseCache);
  });

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

  it("returns a versioned attestation only after all local source comparisons pass", async () => {
    const sourceText = "字幕だけの秘密です。";
    const generated = "週末に新しい道具を試す。";
    const cue = { ...parseSrt(`1\n00:00:01,000 --> 00:00:02,000\n${sourceText}`, "track-distinct")[0]!, tokens: fallbackTokens(sourceText) };
    const key = await Effect.runPromise(getOrCreateSourceSignatureKey());
    await Effect.runPromise(persistSourceExclusionSignatures(
      "track-distinct",
      await Effect.runPromise(buildSourceExclusionSignatures([cue], key)),
    ));
    const embedder = (texts: readonly string[]) => Effect.succeed(texts.map((text) =>
      text === sourceText ? Float32Array.of(1, 0, 0, 0) : Float32Array.of(0, 1, 0, 0)
    ));
    const result = await Effect.runPromise(validateGeneratedSentence(
      generated, generated.indexOf("試す"), generated.indexOf("試す") + 2,
      [cue], "track-distinct", embedder, (sentence) => Effect.succeed(fallbackTokens(sentence)),
    ));
    expect(result).toMatchObject({
      displayable: true,
      attestation: {
        signatureVersion: "source_signature_v1",
        normalizationVersion: "adaptive_media_nfkc_v1",
        semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2",
        decision: "distinct",
      },
    });
  });

  it("uses a locally cached source-validated exercise when the network is unavailable", async () => {
    const knowledgePointId = crypto.randomUUID();
    const exercise = {
      id: crypto.randomUUID(),
      knowledgePointId,
      validatedOnSourceDevice: true as const,
      sourceValidation: {
        signatureVersion: "source_signature_v1" as const,
        normalizationVersion: "adaptive_media_nfkc_v1" as const,
        semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2" as const,
        decision: "distinct" as const,
      },
      content: {
        targetCanonicalKey: "vocabulary:試す:test:動詞",
        context: "Trying a tool at home.",
        japaneseSentence: "道具を試す。",
        targetStart: 3,
        targetEnd: 5,
        answer: "道具を試す。",
        explanation: "A direct attempt.",
        furigana: [{ text: "道具を試す。" }],
        modality: "text_recognition" as const,
        variationTags: ["home", "casual"],
        variationProfile: {
          situation: "home", surroundingVocabulary: ["道具"], conjugation: "dictionary",
          politeness: "casual" as const, register: "spoken", speakerIntention: "report",
          polarity: "positive" as const, questionForm: false,
        },
        qualityChecks: {
          intendedSenseOrFunction: true as const, unambiguousAnswer: true as const,
          naturalJapanese: true as const, registerMatches: true as const,
        },
        prerequisiteCanonicalKeys: [],
        confidence: 0.95,
      },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: exercise }), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));
    expect(await Effect.runPromise(fetchNextValidatedExercise("token", knowledgePointId))).toMatchObject({ id: exercise.id });
    expect(await Effect.runPromise(fetchNextValidatedExercise("token", knowledgePointId))).toMatchObject({ id: exercise.id });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
