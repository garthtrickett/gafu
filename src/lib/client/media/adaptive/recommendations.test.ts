import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { parseSubtitleTrack } from "./subtitles.ts";
import { fallbackTokens } from "./tokenizer.ts";
import {
  requestMediaRecommendations,
  selectMediaAnalysisExcerpts,
  submitMediaCandidateAction,
  validateMediaRecommendations,
} from "./recommendations.ts";

const cues = parseSubtitleTrack("fixture.srt", `1\n00:00:01,000 --> 00:00:02,000\n猫\n\n2\n00:00:03,000 --> 00:00:04,000\n歩く\n`, "fixture")
  .map((cue) => ({ ...cue, tokens: fallbackTokens(cue.normalizedText) }));

describe("media recommendation consent and local evidence validation", () => {
  it("sends only an explicitly consented bounded subset", async () => {
    const excerpts = selectMediaAnalysisExcerpts(cues);
    expect(excerpts).toHaveLength(1);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, data: { proposals: [] } }), { status: 200 }));
    await Effect.runPromise(requestMediaRecommendations("token", "run-1", true, excerpts));
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ consent: true, analysisRunId: "run-1", excerpts });
    fetchSpy.mockRestore();
  });

  it("does not call the network without consent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await Effect.runPromise(Effect.either(requestMediaRecommendations("token", "run-1", false, selectMediaAnalysisExcerpts(cues))));
    expect(result).toMatchObject({ _tag: "Left" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects invalid spans and recomputes evidence timing locally", () => {
    const validCue = cues[1]!;
    const valid = validateMediaRecommendations({ proposals: [{
      kind: "vocabulary",
      canonicalKey: "vocabulary:歩く",
      reading: "あるく",
      meaning: "to walk",
      observedForms: ["歩いた"],
      occurrenceCount: 99,
      firstTimeSeconds: 999,
      prerequisiteCanonicalKeys: [],
      confidence: 0.9,
      reviewCostClass: "light_vocabulary",
      evidence: [{ cueId: validCue.id, start: 0, end: 2, observedSurface: "歩く" }],
    }, {
      kind: "vocabulary",
      canonicalKey: "vocabulary:猫",
      reading: "ねこ",
      meaning: "cat",
      observedForms: ["猫"],
      occurrenceCount: 1,
      firstTimeSeconds: 1,
      prerequisiteCanonicalKeys: [],
      confidence: 0.9,
      reviewCostClass: "light_vocabulary",
      evidence: [{ cueId: validCue.id, start: 0, end: 1, observedSurface: "猫" }],
    }] }, cues, new Set());
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ occurrenceCount: 1, firstTimeSeconds: 3 });
  });

  it("submits candidate provenance without source surface text", async () => {
    const recommendation = {
      candidateId: crypto.randomUUID(),
      kind: "vocabulary" as const,
      canonicalKey: "vocabulary:歩く",
      reading: "あるく",
      meaning: "to walk",
      observedForms: ["歩く"],
      occurrenceCount: 1,
      firstTimeSeconds: 3,
      prerequisiteCanonicalKeys: [],
      confidence: 0.9,
      reviewCostClass: "light_vocabulary" as const,
      evidence: [{ cueId: cues[1]!.id, start: 0, end: 3, observedSurface: "歩いた" }],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, data: { accepted: true, reason: "accepted" } }), { status: 200 }));
    await Effect.runPromise(submitMediaCandidateAction("token", "accept", recommendation, crypto.randomUUID(), "f".repeat(64)));
    const body = String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).not.toContain("observedSurface");
    expect(body).not.toContain("歩いた");
    expect(JSON.parse(body).candidate.evidence).toEqual([{ cueId: cues[1]!.id, start: 0, end: 3 }]);
    fetchSpy.mockRestore();
  });
});
