import { Data, Effect } from "effect";
import {
  MediaRecommendationResultSchema,
  type MediaRecommendationResult,
} from "./schema.ts";
import { normalizeKnowledgePointCanonicalKey } from "../../shared/adaptive-media.ts";

export const MAX_MEDIA_ANALYSIS_EXCERPTS = 12;
export const MAX_MEDIA_ANALYSIS_EXCERPT_LENGTH = 280;

export interface MediaAnalysisExcerpt {
  readonly cueId: string;
  readonly text: string;
  readonly startSeconds: number;
}

export interface MediaAnalysisRequest {
  readonly consent: true;
  readonly analysisRunId: string;
  readonly excerpts: readonly MediaAnalysisExcerpt[];
}

export interface MediaAnalysisAgent {
  generate(
    prompt: string,
    options: { readonly structuredOutput: { readonly schema: typeof MediaRecommendationResultSchema } },
  ): Promise<{ readonly object?: unknown }>;
}

export class MediaAnalysisError extends Data.TaggedError("MediaAnalysisError")<{
  readonly code: "consent_required" | "invalid_excerpt_batch" | "service_unavailable" | "invalid_result";
}> {}

const validateRequest = (request: MediaAnalysisRequest) => {
  if (request.consent !== true) return new MediaAnalysisError({ code: "consent_required" });
  if (
    request.analysisRunId.length === 0 ||
    request.excerpts.length === 0 ||
    request.excerpts.length > MAX_MEDIA_ANALYSIS_EXCERPTS ||
    request.excerpts.some((excerpt) =>
      excerpt.cueId.length === 0 ||
      excerpt.text.length === 0 ||
      excerpt.text.length > MAX_MEDIA_ANALYSIS_EXCERPT_LENGTH ||
      !Number.isFinite(excerpt.startSeconds) ||
      excerpt.startSeconds < 0
    )
  ) return new MediaAnalysisError({ code: "invalid_excerpt_batch" });
  return null;
};

const makePrompt = (request: MediaAnalysisRequest): string => JSON.stringify({
  contract: "adaptive_media_recommendations_v1",
  offsetUnit: "utf16_code_units",
  normalizationVersion: "adaptive_media_nfkc_v1",
  excerpts: request.excerpts.map((excerpt) => ({
    cueId: excerpt.cueId,
    text: excerpt.text,
    startSeconds: excerpt.startSeconds,
  })),
});

export const analyzeMediaExcerpts = (
  request: MediaAnalysisRequest,
  agentOverride?: MediaAnalysisAgent,
): Effect.Effect<MediaRecommendationResult, MediaAnalysisError> => Effect.gen(function* () {
  const requestError = validateRequest(request);
  if (requestError) return yield* Effect.fail(requestError);
  const agent = agentOverride ?? (yield* Effect.tryPromise({
    try: async () => {
      const { mastra } = await import("../../../../mastra.config.ts");
      return mastra.getAgentById("adaptive-media-analysis") as MediaAnalysisAgent | undefined;
    },
    catch: () => new MediaAnalysisError({ code: "service_unavailable" }),
  }));
  if (!agent) return yield* Effect.fail(new MediaAnalysisError({ code: "service_unavailable" }));

  yield* Effect.logInfo("[MediaAnalysis] analysis_started").pipe(Effect.annotateLogs({
    analysisRunId: request.analysisRunId,
    excerptCount: request.excerpts.length,
  }));
  const response = yield* Effect.tryPromise({
    try: () => agent.generate(makePrompt(request), {
      structuredOutput: { schema: MediaRecommendationResultSchema },
    }),
    catch: () => new MediaAnalysisError({ code: "service_unavailable" }),
  });
  const parsed = MediaRecommendationResultSchema.safeParse(response.object);
  if (!parsed.success) return yield* Effect.fail(new MediaAnalysisError({ code: "invalid_result" }));
  const proposals = parsed.data.proposals.flatMap((proposal) => {
    const canonicalKey = normalizeKnowledgePointCanonicalKey(proposal.kind, proposal.canonicalKey);
    return canonicalKey ? [{ ...proposal, canonicalKey }] : [];
  });
  const normalizedCount = parsed.data.proposals.filter((proposal) => {
    const canonicalKey = normalizeKnowledgePointCanonicalKey(proposal.kind, proposal.canonicalKey);
    return canonicalKey !== null && canonicalKey !== proposal.canonicalKey;
  }).length;
  yield* Effect.logInfo("[MediaAnalysis] analysis_completed").pipe(Effect.annotateLogs({
    analysisRunId: request.analysisRunId,
    proposalCount: proposals.length,
    normalizedCanonicalKeyCount: normalizedCount,
    rejectedCanonicalKeyCount: parsed.data.proposals.length - proposals.length,
  }));
  return { proposals };
});
