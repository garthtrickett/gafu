import { Schema } from "effect";

export const CamelCaseReviewSchema = Schema.Struct({
  knowledgePointId: Schema.UUID,
  easeFactor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  intervalDays: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  nextReview: Schema.String,
  difficulty: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 5.0)),
  stability: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 0.0)),
  lastReviewedAt: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

export const SnakeCaseReviewSchema = Schema.Struct({
  knowledge_point_id: Schema.UUID,
  ease_factor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  interval_days: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  next_review: Schema.String,
  difficulty: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 5.0)),
  stability: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 0.0)),
  last_reviewed_at: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

// Kept only for the migration window. Encoding always emits the canonical
// knowledge-point contract, so new outbox entries cannot regress.
export const LegacyCamelCaseReviewSchema = Schema.Struct({
  grammarPointId: Schema.UUID,
  easeFactor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  intervalDays: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  nextReview: Schema.String,
  difficulty: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 5.0)),
  stability: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 0.0)),
  lastReviewedAt: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

export const LegacySnakeCaseReviewSchema = Schema.Struct({
  grammar_point_id: Schema.UUID,
  ease_factor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  interval_days: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  next_review: Schema.String,
  difficulty: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 5.0)),
  stability: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 0.0)),
  last_reviewed_at: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

export const RecordReviewPayloadSchema = Schema.transform(
  Schema.Union(
    CamelCaseReviewSchema,
    SnakeCaseReviewSchema,
    LegacyCamelCaseReviewSchema,
    LegacySnakeCaseReviewSchema
  ),
  Schema.Struct({
    knowledgePointId: Schema.UUID,
    easeFactor: Schema.Number,
    repetitions: Schema.Int,
    intervalDays: Schema.Int,
    nextReview: Schema.String,
    difficulty: Schema.Number,
    stability: Schema.Number,
    lastReviewedAt: Schema.NullOr(Schema.String),
  }),
  {
    decode: (input) => {
      if ("knowledge_point_id" in input) {
        return {
          knowledgePointId: input.knowledge_point_id,
          easeFactor: input.ease_factor,
          repetitions: input.repetitions,
          intervalDays: input.interval_days,
          nextReview: input.next_review,
          difficulty: input.difficulty,
          stability: input.stability,
          lastReviewedAt: input.last_reviewed_at,
        };
      }
      if ("grammar_point_id" in input) {
        return {
          knowledgePointId: input.grammar_point_id,
          easeFactor: input.ease_factor,
          repetitions: input.repetitions,
          intervalDays: input.interval_days,
          nextReview: input.next_review,
          difficulty: input.difficulty,
          stability: input.stability,
          lastReviewedAt: input.last_reviewed_at,
        };
      }
      if ("grammarPointId" in input) {
        return {
          knowledgePointId: input.grammarPointId,
          easeFactor: input.easeFactor,
          repetitions: input.repetitions,
          intervalDays: input.intervalDays,
          nextReview: input.nextReview,
          difficulty: input.difficulty,
          stability: input.stability,
          lastReviewedAt: input.lastReviewedAt,
        };
      }
      return {
        knowledgePointId: input.knowledgePointId,
        easeFactor: input.easeFactor,
        repetitions: input.repetitions,
        intervalDays: input.intervalDays,
        nextReview: input.nextReview,
        difficulty: input.difficulty,
        stability: input.stability,
        lastReviewedAt: input.lastReviewedAt,
      };
    },
    encode: (normalized) => ({
      knowledgePointId: normalized.knowledgePointId,
      easeFactor: normalized.easeFactor,
      repetitions: normalized.repetitions,
      intervalDays: normalized.intervalDays,
      nextReview: normalized.nextReview,
      difficulty: normalized.difficulty,
      stability: normalized.stability,
      lastReviewedAt: normalized.lastReviewedAt,
    }),
  }
);

export type RecordReviewPayload = Schema.Schema.Type<typeof RecordReviewPayloadSchema>;

export const UpdatePreferencesPayloadSchema = Schema.Struct({
  dailyReviewLimit: Schema.Int.pipe(Schema.nonNegative()),
  dailyNewRuleLimit: Schema.Int.pipe(Schema.nonNegative()),
  enforceMasteryGates: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => true)),
  learnerTimeZone: Schema.optional(Schema.String).pipe(Schema.withDecodingDefault(() => "UTC")),
});

export type UpdatePreferencesPayload = Schema.Schema.Type<typeof UpdatePreferencesPayloadSchema>;

export const ToggleSkinPayloadSchema = Schema.Unknown;
export const UnlockDeckPayloadSchema = Schema.Unknown;

export const RecordReviewTransactionSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("record_review"),
  payload: RecordReviewPayloadSchema,
  hlc: Schema.String,
});

export const UpdatePreferencesTransactionSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("update_preferences"),
  payload: UpdatePreferencesPayloadSchema,
  hlc: Schema.String,
});

export const ToggleSkinTransactionSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("toggle_skin"),
  payload: ToggleSkinPayloadSchema,
  hlc: Schema.String,
});

export const UnlockDeckTransactionSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("unlock_deck"),
  payload: UnlockDeckPayloadSchema,
  hlc: Schema.String,
});

export const OutboxTransactionSchema = Schema.Union(
  RecordReviewTransactionSchema,
  UpdatePreferencesTransactionSchema,
  ToggleSkinTransactionSchema,
  UnlockDeckTransactionSchema
);

export type OutboxTransaction = Schema.Schema.Type<typeof OutboxTransactionSchema>;
