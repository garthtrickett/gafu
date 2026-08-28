import { Effect } from "effect";
import type { MediaRecommendationProposal, MediaRecommendationResult } from "../../../server/ai/schema.ts";
import type { NormalizedCue } from "../../../shared/adaptive-media.ts";

export interface ConsentedMediaExcerpt {
  readonly cueId: string;
  readonly text: string;
  readonly startSeconds: number;
}

export const selectMediaAnalysisExcerpts = (cues: readonly NormalizedCue[]): readonly ConsentedMediaExcerpt[] => {
  if (cues.length === 0) return [];
  // A bounded evidence sample avoids treating the complete subtitle archive as
  // a convenient AI prompt. A one-cue fixture is the only unavoidable exception.
  const limit = cues.length === 1 ? 1 : Math.min(12, Math.max(1, Math.ceil(cues.length * 0.1)));
  return cues
    .filter((cue) => cue.tokens.some((token) => !token.punctuation && !token.lineBreak))
    .slice(0, limit)
    .map((cue) => ({
      cueId: cue.id,
      text: cue.normalizedText.slice(0, 280),
      startSeconds: cue.sourceStartSeconds,
    }));
};

export const requestMediaRecommendations = (
  token: string,
  analysisRunId: string,
  consent: boolean,
  excerpts: readonly ConsentedMediaExcerpt[],
): Effect.Effect<MediaRecommendationResult, Error> => Effect.gen(function* () {
  if (!consent) return yield* Effect.fail(new Error("Explicit subtitle excerpt consent is required."));
  if (excerpts.length === 0 || excerpts.length > 12) return yield* Effect.fail(new Error("No bounded subtitle evidence is available."));
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/analysis/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consent: true, analysisRunId, excerpts }),
    }),
    catch: () => new Error("Media analysis service is unreachable."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Media analysis is unavailable; local playback is unaffected."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: MediaRecommendationResult }>,
    catch: () => new Error("Media analysis returned an unreadable result."),
  });
  if (!payload.success || !payload.data || !Array.isArray(payload.data.proposals)) {
    return yield* Effect.fail(new Error("Media analysis returned an invalid result."));
  }
  return payload.data;
});

export interface ValidatedMediaRecommendation extends MediaRecommendationProposal {
  readonly occurrenceCount: number;
  readonly firstTimeSeconds: number;
}

export type MediaCandidateAction = "accept" | "already_known" | "rejected" | "not_useful" | "wrongly_analyzed";

export interface ActionableMediaRecommendation extends ValidatedMediaRecommendation {
  readonly candidateId: string;
}

export const submitMediaCandidateAction = (
  token: string,
  action: MediaCandidateAction,
  recommendation: ActionableMediaRecommendation,
  analysisRunId: string,
  subtitleTrackFingerprint: string,
): Effect.Effect<{ readonly accepted: boolean; readonly reason: string; readonly knowledgePointId?: string }, Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/adaptive-media/candidates/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action,
        idempotencyKey: `media:${recommendation.candidateId}:${action}`,
        candidate: {
          id: recommendation.candidateId,
          analysisRunId,
          subtitleTrackFingerprint,
          kind: recommendation.kind,
          canonicalKey: recommendation.canonicalKey,
          reading: recommendation.reading || null,
          meaning: recommendation.meaning,
          confidence: recommendation.confidence,
          reviewCostClass: recommendation.reviewCostClass,
          // Source surface text is deliberately removed after local validation.
          evidence: recommendation.evidence.map((evidence) => ({
            cueId: evidence.cueId,
            start: evidence.start,
            end: evidence.end,
          })),
          firstEncounterSeconds: recommendation.firstTimeSeconds,
          occurrenceCount: recommendation.occurrenceCount,
        },
      }),
    }),
    catch: () => new Error("Candidate action could not reach Gafu."),
  });
  if (!response.ok) return yield* Effect.fail(new Error("Candidate action was rejected."));
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ readonly success?: boolean; readonly data?: { readonly accepted: boolean; readonly reason: string; readonly knowledgePointId?: string } }>,
    catch: () => new Error("Candidate action returned an unreadable result."),
  });
  if (!payload.success || !payload.data) return yield* Effect.fail(new Error("Candidate action returned an invalid result."));
  return payload.data;
});

export const validateMediaRecommendations = (
  result: MediaRecommendationResult,
  cues: readonly NormalizedCue[],
  canonicalKeys: ReadonlySet<string>,
): readonly ValidatedMediaRecommendation[] => result.proposals.flatMap((proposal) => {
  if (proposal.confidence < 0.6 || proposal.evidence.length === 0) return [];
  const validEvidence = proposal.evidence.flatMap((evidence) => {
    const cue = cues.find((candidate) => candidate.id === evidence.cueId);
    if (!cue || evidence.end <= evidence.start || cue.normalizedText.slice(evidence.start, evidence.end) !== evidence.observedSurface) return [];
    if (proposal.kind === "vocabulary" && !cue.tokens.some((token) =>
      token.span.start === evidence.start &&
      token.span.end === evidence.end &&
      proposal.canonicalKey.includes(token.lemma.normalize("NFKC"))
    )) return [];
    if (proposal.kind === "grammar" && !canonicalKeys.has(proposal.canonicalKey)) return [];
    return [{ evidence, cue }];
  });
  if (validEvidence.length !== proposal.evidence.length) return [];
  return [{
    ...proposal,
    occurrenceCount: validEvidence.length,
    firstTimeSeconds: Math.min(...validEvidence.map(({ cue }) => cue.sourceStartSeconds)),
  }];
});
