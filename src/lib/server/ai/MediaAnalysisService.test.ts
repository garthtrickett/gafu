import { Effect, HashMap, Logger } from "effect";
import { describe, expect, it, vi } from "vitest";
import { analyzeMediaExcerpts, type MediaAnalysisAgent } from "./MediaAnalysisService.ts";

const request = {
  consent: true as const,
  analysisRunId: "analysis-test",
  excerpts: [{ cueId: "cue-private", text: "未公開の合成字幕", startSeconds: 12.5 }],
};

describe("MediaAnalysisService privacy boundary", () => {
  it("sends only bounded consented excerpts and returns structured proposals", async () => {
    const generate = vi.fn<MediaAnalysisAgent["generate"]>(async () => ({ object: {
      proposals: [{
        kind: "vocabulary",
        canonicalKey: "vocabulary:歩く:アルク:動詞",
        reading: "あるく",
        meaning: "to walk",
        observedForms: ["歩く"],
        occurrenceCount: 1,
        firstTimeSeconds: 12.5,
        prerequisiteCanonicalKeys: [],
        confidence: 0.91,
        reviewCostClass: "light_vocabulary",
        evidence: [{ cueId: "cue-private", start: 0, end: 2, observedSurface: "未公" }],
      }],
    } }));
    const result = await Effect.runPromise(analyzeMediaExcerpts(request, { generate }));
    expect(result.proposals).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[0]).toContain(request.excerpts[0]!.text);
    expect(generate.mock.calls[0]?.[1]).toEqual({ structuredOutput: { schema: expect.any(Object) } });
  });

  it("normalizes a bare provider canonical key before returning it to the client", async () => {
    const generate = vi.fn<MediaAnalysisAgent["generate"]>(async () => ({ object: {
      proposals: [{
        kind: "vocabulary",
        canonicalKey: "もったいない",
        reading: "もったいない",
        meaning: "wasteful",
        observedForms: ["もったいない"],
        occurrenceCount: 1,
        firstTimeSeconds: 12.5,
        prerequisiteCanonicalKeys: [],
        confidence: 0.99,
        reviewCostClass: "light_vocabulary",
        evidence: [{ cueId: "cue-private", start: 0, end: 6, observedSurface: "未公開の合成" }],
      }],
    } }));

    const result = await Effect.runPromise(analyzeMediaExcerpts(request, { generate }));

    expect(result.proposals[0]?.canonicalKey).toBe("vocabulary:もったいない");
  });

  it("never places excerpt or result text in application logs or failures", async () => {
    const logged: string[] = [];
    const logger = Logger.make<unknown, void>((options) => { logged.push(JSON.stringify({
      message: options.message,
      annotations: [...HashMap.toEntries(options.annotations)],
    })); });
    const failingAgent = { generate: vi.fn<MediaAnalysisAgent["generate"]>(async () => { throw new Error(`provider echoed ${request.excerpts[0]!.text}`); }) };
    const result = await Effect.runPromise(
      Effect.either(analyzeMediaExcerpts(request, failingAgent)).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "MediaAnalysisError", code: "service_unavailable" } });
    expect(logged.join("\n")).not.toContain(request.excerpts[0]!.text);
  });

  it("rejects absent consent and oversized batches before invoking the agent", async () => {
    const generate = vi.fn<MediaAnalysisAgent["generate"]>();
    const noConsent = await Effect.runPromise(Effect.either(analyzeMediaExcerpts({
      ...request,
      consent: false as never,
    }, { generate })));
    const tooMany = await Effect.runPromise(Effect.either(analyzeMediaExcerpts({
      ...request,
      excerpts: Array.from({ length: 13 }, (_, index) => ({ cueId: `cue-${index}`, text: "短い字幕", startSeconds: index })),
    }, { generate })));
    expect(noConsent).toMatchObject({ _tag: "Left", left: { code: "consent_required" } });
    expect(tooMany).toMatchObject({ _tag: "Left", left: { code: "invalid_excerpt_batch" } });
    expect(generate).not.toHaveBeenCalled();
  });
});
