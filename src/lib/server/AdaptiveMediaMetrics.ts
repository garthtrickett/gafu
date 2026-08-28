import { Data, Effect } from "effect";

export type AdaptiveMediaMetric =
  | { readonly name: "recommendation_completed"; readonly analysisRunId: string; readonly proposalCount: number }
  | { readonly name: "candidate_action"; readonly candidateId: string; readonly action: "accept" | "already_known" | "rejected" | "not_useful" | "wrongly_analyzed"; readonly accepted: boolean }
  | { readonly name: "capacity_decision"; readonly knowledgePointId: string; readonly reason: "accepted" | "already_scheduled" | "daily_limit" | "unstable_pool" | "mature_backlog" }
  | { readonly name: "checkout_completed"; readonly knowledgePointId: string; readonly outcome: "recalled" | "missed" | "already_known" | "wrongly_analyzed" | "not_useful" }
  | { readonly name: "exercise_validation"; readonly knowledgePointId: string; readonly outcome: "accepted" | "rejected"; readonly reason: string }
  | { readonly name: "mastery_review"; readonly knowledgePointId: string; readonly recalled: boolean; readonly variedContextCount: number; readonly masteryLimited: boolean }
  | { readonly name: "queue_opened"; readonly pendingFreshCount: number; readonly freshOfferedCount: number };

const allowedFields: Readonly<Record<AdaptiveMediaMetric["name"], ReadonlySet<string>>> = {
  recommendation_completed: new Set(["name", "analysisRunId", "proposalCount"]),
  candidate_action: new Set(["name", "candidateId", "action", "accepted"]),
  capacity_decision: new Set(["name", "knowledgePointId", "reason"]),
  checkout_completed: new Set(["name", "knowledgePointId", "outcome"]),
  exercise_validation: new Set(["name", "knowledgePointId", "outcome", "reason"]),
  mastery_review: new Set(["name", "knowledgePointId", "recalled", "variedContextCount", "masteryLimited"]),
  queue_opened: new Set(["name", "pendingFreshCount", "freshOfferedCount"]),
};

const forbiddenField = /(source|subtitle|sentence|answer|filename|file_name|media_metadata|prompt|cue_text)/i;

export class UnsafeAdaptiveMediaMetric extends Data.TaggedError("UnsafeAdaptiveMediaMetric") {}

export const recordAdaptiveMediaMetric = (metric: AdaptiveMediaMetric): Effect.Effect<void, UnsafeAdaptiveMediaMetric> => {
  const fields = Object.keys(metric);
  const allowlist = allowedFields[metric.name];
  if (fields.some((field) => !allowlist.has(field) || forbiddenField.test(field))) {
    return Effect.fail(new UnsafeAdaptiveMediaMetric());
  }
  return Effect.logInfo("adaptive_media_metric").pipe(Effect.annotateLogs(metric));
};
