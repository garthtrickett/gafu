import { Data, Effect } from "effect";
import { sql } from "kysely";
import { db } from "../../../db/client.ts";

export interface TtsSynthesisReservation {
  readonly usageDate: string;
  readonly attemptedCount: number;
  readonly dailyLimit: number;
}

export interface TtsSynthesisBudget {
  readonly reserve: () => Effect.Effect<
    TtsSynthesisReservation,
    TtsSynthesisBudgetError
  >;
}

export class TtsSynthesisBudgetError extends Data.TaggedError(
  "TtsSynthesisBudgetError",
)<{
  readonly kind: "limit" | "storage";
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface TtsUsageRow {
  readonly usage_date: string;
  readonly attempted_count: number;
}

export const makePostgresTtsSynthesisBudget = (
  dailyLimit: number,
): TtsSynthesisBudget => ({
  reserve: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          sql<TtsUsageRow>`
            INSERT INTO tts_daily_usage (
              usage_date,
              attempted_count,
              updated_at
            )
            VALUES (
              (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
              1,
              NOW()
            )
            ON CONFLICT (usage_date)
            DO UPDATE SET
              attempted_count =
                tts_daily_usage.attempted_count + 1,
              updated_at = NOW()
            WHERE
              tts_daily_usage.attempted_count < ${dailyLimit}
            RETURNING
              usage_date::text AS usage_date,
              attempted_count
          `.execute(db),
        catch: (cause) =>
          new TtsSynthesisBudgetError({
            kind: "storage",
            message:
              "Failed to reserve the daily TTS synthesis budget.",
            cause,
          }),
      });

      const row = result.rows[0];
      if (!row) {
        yield* Effect.logWarning(
          "[TtsSynthesisBudget] daily_limit_reached",
          {
            event: "tts_daily_limit_reached",
            dailyLimit,
          },
        );
        return yield* Effect.fail(
          new TtsSynthesisBudgetError({
            kind: "limit",
            message:
              "The daily TTS synthesis ceiling has been reached. Existing cached audio remains available.",
          }),
        );
      }

      const reservation = {
        usageDate: row.usage_date,
        attemptedCount: Number(row.attempted_count),
        dailyLimit,
      } satisfies TtsSynthesisReservation;

      yield* Effect.logInfo(
        "[TtsSynthesisBudget] reservation_created",
        {
          event: "tts_budget_reservation",
          usageDate: reservation.usageDate,
          attemptedCount: reservation.attemptedCount,
          dailyLimit,
        },
      );

      return reservation;
    }),
});

export const makeInMemoryTtsSynthesisBudget = (
  dailyLimit: number,
  currentDate: () => string = () =>
    new Date().toISOString().slice(0, 10),
): TtsSynthesisBudget => {
  let usageDate = currentDate();
  let attemptedCount = 0;

  return {
    reserve: () =>
      Effect.gen(function* () {
        const today = currentDate();
        if (today !== usageDate) {
          usageDate = today;
          attemptedCount = 0;
        }

        if (attemptedCount >= dailyLimit) {
          return yield* Effect.fail(
            new TtsSynthesisBudgetError({
              kind: "limit",
              message:
                "The daily TTS synthesis ceiling has been reached. Existing cached audio remains available.",
            }),
          );
        }

        attemptedCount += 1;
        return {
          usageDate,
          attemptedCount,
          dailyLimit,
        };
      }),
  };
};
