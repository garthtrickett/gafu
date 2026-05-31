import { Schema } from "effect";

export const CamelCaseReviewSchema = Schema.Struct({
  grammarPointId: Schema.UUID,
  easeFactor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  intervalDays: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  nextReview: Schema.String,
});

export const SnakeCaseReviewSchema = Schema.Struct({
  grammar_point_id: Schema.UUID,
  ease_factor: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 2.5)),
  repetitions: Schema.Int,
  interval_days: Schema.optional(Schema.Int).pipe(Schema.withDecodingDefault(() => 0)),
  next_review: Schema.String,
});

export const RecordReviewPayloadSchema = Schema.transform(
  Schema.Union(CamelCaseReviewSchema, SnakeCaseReviewSchema),
  Schema.Struct({
    grammarPointId: Schema.UUID,
    easeFactor: Schema.Number,
    repetitions: Schema.Int,
    intervalDays: Schema.Int,
    nextReview: Schema.String,
  }),
  {
    decode: (input) => {
      const grammarPointId = "grammarPointId" in input ? input.grammarPointId : input.grammar_point_id;
      const easeFactor = "easeFactor" in input ? input.easeFactor : input.ease_factor;
      const repetitions = input.repetitions;
      const intervalDays = "intervalDays" in input ? input.intervalDays : input.interval_days;
      const nextReview = "nextReview" in input ? input.nextReview : input.next_review;

      return {
        grammarPointId,
        easeFactor,
        repetitions,
        intervalDays,
        nextReview,
      } as any;
    },
    encode: (normalized) => ({
      grammarPointId: normalized.grammarPointId,
      easeFactor: normalized.easeFactor,
      repetitions: normalized.repetitions,
      intervalDays: normalized.intervalDays,
      nextReview: normalized.nextReview,
    }) as any,
  }
);

export type RecordReviewPayload = Schema.Schema.Type<typeof RecordReviewPayloadSchema>;

export const UpdatePreferencesPayloadSchema = Schema.Struct({
  dailyReviewLimit: Schema.Int.pipe(Schema.nonNegative()),
  dailyNewRuleLimit: Schema.Int.pipe(Schema.nonNegative()),
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
