import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { getAdaptiveMediaReleaseConfig, requireAdaptiveMediaAiAdmission } from "./AdaptiveMediaRelease.ts";

describe("adaptive media release controls", () => {
  it("defaults to internal rollout and supports an immediate server admission kill switch", async () => {
    expect(getAdaptiveMediaReleaseConfig({})).toEqual({ rolloutStage: "internal", aiAdmissionEnabled: true });
    expect(getAdaptiveMediaReleaseConfig({
      ADAPTIVE_MEDIA_ROLLOUT_STAGE: "limited_beta",
      ADAPTIVE_MEDIA_AI_ADMISSION_ENABLED: "false",
    })).toEqual({ rolloutStage: "limited_beta", aiAdmissionEnabled: false });
    expect(await Effect.runPromise(Effect.either(requireAdaptiveMediaAiAdmission({
      ADAPTIVE_MEDIA_AI_ADMISSION_ENABLED: "false",
    })))).toMatchObject({ _tag: "Left" });
  });

  it("fails unknown rollout stages back to internal", () => {
    expect(getAdaptiveMediaReleaseConfig({ ADAPTIVE_MEDIA_ROLLOUT_STAGE: "everybody_now" }).rolloutStage).toBe("internal");
  });
});
