import { Schema } from "effect";

export const KnowledgePointKindSchema = Schema.Literal("grammar", "vocabulary");
export type KnowledgePointKind = Schema.Schema.Type<typeof KnowledgePointKindSchema>;

export const KnowledgePointScopeSchema = Schema.Literal("curated", "personal");
export type KnowledgePointScope = Schema.Schema.Type<typeof KnowledgePointScopeSchema>;

export const CatalogueStatusSchema = Schema.Literal("active", "archived", "quarantined");
export type CatalogueStatus = Schema.Schema.Type<typeof CatalogueStatusSchema>;

export const ParticipationStatusSchema = Schema.Literal("active", "archived");
export type ParticipationStatus = Schema.Schema.Type<typeof ParticipationStatusSchema>;

export const LearningStateSchema = Schema.Literal(
  "introduced",
  "primed",
  "encountered",
  "learning",
  "stable",
  "known",
);
export type LearningState = Schema.Schema.Type<typeof LearningStateSchema>;

export const CandidateDispositionSchema = Schema.Literal(
  "pending",
  "accepted",
  "rejected",
  "already_known",
  "not_useful",
  "wrongly_analyzed",
);
export type CandidateDisposition = Schema.Schema.Type<typeof CandidateDispositionSchema>;

export const LearnerProgressEventSchema = Schema.Literal(
  "primer_started",
  "primer_retrieval_completed",
  "cue_reached",
  "checkout_recalled",
  "checkout_missed",
  "media_abandoned",
  "mark_known",
  "varied_mastery_reached",
);
export type LearnerProgressEvent = Schema.Schema.Type<typeof LearnerProgressEventSchema>;

export const NORMALIZED_CUE_VERSION = "adaptive_media_nfkc_v1" as const;
export const SOURCE_SIGNATURE_VERSION = "source_signature_v1" as const;
export const TARGET_OFFSET_UNIT = "utf16_code_units" as const;

export const TargetSpanSchema = Schema.Struct({
  start: Schema.Int.pipe(Schema.nonNegative()),
  end: Schema.Int.pipe(Schema.nonNegative()),
  offsetUnit: Schema.Literal(TARGET_OFFSET_UNIT),
  normalizationVersion: Schema.Literal(NORMALIZED_CUE_VERSION),
});
export type TargetSpan = Schema.Schema.Type<typeof TargetSpanSchema>;

export const NormalizedTokenSchema = Schema.Struct({
  surface: Schema.String,
  lemma: Schema.String,
  reading: Schema.String,
  partOfSpeech: Schema.Array(Schema.String),
  conjugationType: Schema.NullOr(Schema.String),
  conjugationForm: Schema.NullOr(Schema.String),
  punctuation: Schema.Boolean,
  lineBreak: Schema.Boolean,
  span: TargetSpanSchema,
});
export type NormalizedToken = Schema.Schema.Type<typeof NormalizedTokenSchema>;

export const TimingTransformSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal("timing_transform_v1"),
  scale: Schema.Number,
  offsetSeconds: Schema.Number,
});
export type TimingTransform = Schema.Schema.Type<typeof TimingTransformSchema>;

export const NormalizedCueSchema = Schema.Struct({
  id: Schema.String,
  subtitleTrackFingerprint: Schema.String,
  sourceCueOrdinal: Schema.Int.pipe(Schema.nonNegative()),
  sourceStartSeconds: Schema.Number,
  sourceEndSeconds: Schema.Number,
  normalizedText: Schema.String,
  normalizationVersion: Schema.Literal(NORMALIZED_CUE_VERSION),
  tokens: Schema.Array(NormalizedTokenSchema),
});
export type NormalizedCue = Schema.Schema.Type<typeof NormalizedCueSchema>;

export const CandidateEvidenceSchema = Schema.Struct({
  cueId: Schema.String,
  targetSpan: TargetSpanSchema,
  observedSurface: Schema.String,
});
export type CandidateEvidence = Schema.Schema.Type<typeof CandidateEvidenceSchema>;

export const MediaCandidateSchema = Schema.Struct({
  id: Schema.String,
  analysisRunId: Schema.String,
  kind: KnowledgePointKindSchema,
  canonicalKey: Schema.String,
  meaning: Schema.String,
  confidence: Schema.Number,
  disposition: CandidateDispositionSchema,
  evidence: Schema.Array(CandidateEvidenceSchema),
  resolvedKnowledgePointId: Schema.NullOr(Schema.String),
});
export type MediaCandidate = Schema.Schema.Type<typeof MediaCandidateSchema>;

export const ExerciseModalitySchema = Schema.Literal(
  "text_recognition",
  "listening_recognition",
  "production",
);
export type ExerciseModality = Schema.Schema.Type<typeof ExerciseModalitySchema>;

export const GeneratedExerciseSchema = Schema.Struct({
  id: Schema.String,
  knowledgePointId: Schema.String,
  context: Schema.String,
  japaneseSentence: Schema.String,
  targetSpan: TargetSpanSchema,
  answer: Schema.String,
  explanation: Schema.String,
  modality: ExerciseModalitySchema,
  variationTags: Schema.Array(Schema.String),
  prerequisiteIds: Schema.Array(Schema.String),
  sourceSignatureVersion: Schema.Literal(SOURCE_SIGNATURE_VERSION),
  validationStatus: Schema.Literal("pending", "accepted", "rejected"),
});
export type GeneratedExercise = Schema.Schema.Type<typeof GeneratedExerciseSchema>;

type AcceptedTransition = Readonly<{
  _tag: "TransitionAccepted";
  previousState: LearningState | null;
  nextState: LearningState;
  event: LearnerProgressEvent;
}>;

type RejectedTransition = Readonly<{
  _tag: "TransitionRejected";
  state: LearningState | null;
  event: LearnerProgressEvent;
  reason: string;
}>;

export type LearnerProgressTransition = AcceptedTransition | RejectedTransition;

const acceptedTransition = (
  previousState: LearningState | null,
  nextState: LearningState,
  event: LearnerProgressEvent,
): AcceptedTransition => ({
  _tag: "TransitionAccepted",
  previousState,
  nextState,
  event,
});

const rejectedTransition = (
  state: LearningState | null,
  event: LearnerProgressEvent,
): RejectedTransition => ({
  _tag: "TransitionRejected",
  state,
  event,
  reason: `Event ${event} is not valid from ${state ?? "no learner progress"}.`,
});

export const transitionLearnerProgress = (
  state: LearningState | null,
  event: LearnerProgressEvent,
): LearnerProgressTransition => {
  if (event === "mark_known") {
    return acceptedTransition(state, "known", event);
  }
  if (state === null && event === "primer_started") {
    return acceptedTransition(state, "introduced", event);
  }
  if (state === "introduced" && event === "primer_started") {
    return acceptedTransition(state, state, event);
  }
  if (state === "introduced" && event === "primer_retrieval_completed") {
    return acceptedTransition(state, "primed", event);
  }
  if (state === "primed" && event === "cue_reached") {
    return acceptedTransition(state, "encountered", event);
  }
  if (
    (state === "primed" || state === "encountered") &&
    (event === "checkout_recalled" || event === "checkout_missed" || event === "media_abandoned")
  ) {
    return acceptedTransition(state, "learning", event);
  }
  if (state === "learning" && event === "varied_mastery_reached") {
    return acceptedTransition(state, "stable", event);
  }
  if (state === "encountered" && event === "cue_reached") {
    return acceptedTransition(state, state, event);
  }
  return rejectedTransition(state, event);
};

export type QuarantineTarget = "analysis_evidence" | "personal_knowledge_point";

export const quarantineTargetForWrongAnalysis = (
  scope: KnowledgePointScope,
  canonicalDefinitionInvalid: boolean,
): QuarantineTarget =>
  scope === "personal" && canonicalDefinitionInvalid
    ? "personal_knowledge_point"
    : "analysis_evidence";

export const candidateOwnsSchedule = (_disposition: CandidateDisposition): false => false;

export const learnerProgressIsDue = (
  participationStatus: ParticipationStatus,
  learningState: LearningState,
): boolean =>
  participationStatus === "active" && learningState !== "known";
