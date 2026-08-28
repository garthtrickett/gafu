import { Data, Effect } from "effect";

export type AdaptiveMediaRolloutStage = "internal" | "development_opt_in" | "limited_beta" | "general_availability";

export interface AdaptiveMediaReleaseConfig {
  readonly rolloutStage: AdaptiveMediaRolloutStage;
  readonly aiAdmissionEnabled: boolean;
}

const rolloutStages = new Set<AdaptiveMediaRolloutStage>([
  "internal", "development_opt_in", "limited_beta", "general_availability",
]);

export const getAdaptiveMediaReleaseConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdaptiveMediaReleaseConfig => {
  const requestedStage = environment.ADAPTIVE_MEDIA_ROLLOUT_STAGE as AdaptiveMediaRolloutStage | undefined;
  return {
    rolloutStage: requestedStage && rolloutStages.has(requestedStage) ? requestedStage : "internal",
    aiAdmissionEnabled: environment.ADAPTIVE_MEDIA_AI_ADMISSION_ENABLED !== "false",
  };
};

export class AdaptiveMediaAdmissionDisabled extends Data.TaggedError("AdaptiveMediaAdmissionDisabled") {}

export const requireAdaptiveMediaAiAdmission = (
  environment?: Readonly<Record<string, string | undefined>>,
) => getAdaptiveMediaReleaseConfig(environment).aiAdmissionEnabled
  ? Effect.void
  : Effect.fail(new AdaptiveMediaAdmissionDisabled());
