import "dotenv/config";
import { Cause, Data, Effect, Exit } from "effect";
import { closeDb, db } from "./client.ts";
import type {
  KnowledgePointId,
  NewSrsCard,
  SrsCardId,
  SyncEpochId,
  UserId,
} from "../types/index.ts";

const GRADUATED_STABILITY_DAYS = 30;
const GRADUATED_REPETITIONS = 3;

class GraduateAllProgressError extends Data.TaggedError("GraduateAllProgressError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const makeGraduateHlc = (now: Date): string =>
  `${String(now.getTime()).padStart(13, "0")}:0000:graduate-all`;

export const graduateAllKnowledgePoints = (targetEmail: string, now: Date = new Date()) =>
  Effect.gen(function* () {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (normalizedEmail.length === 0) {
      return yield* Effect.fail(new GraduateAllProgressError({ message: "A target learner email is required." }));
    }

    yield* Effect.logInfo(`[GraduateAllProgress] Preparing full graduation for email=${normalizedEmail}.`);
    const user = yield* Effect.tryPromise({
      try: () => db.selectFrom("user")
        .select(["id", "email"])
        .where("email", "=", normalizedEmail)
        .executeTakeFirst(),
      catch: (cause) => new GraduateAllProgressError({
        message: `Failed to look up learner email=${normalizedEmail}.`,
        cause,
      }),
    });
    if (!user) {
      return yield* Effect.fail(new GraduateAllProgressError({
        message: `No learner exists with email=${normalizedEmail}.`,
      }));
    }

    const activePoints = yield* Effect.tryPromise({
      try: () => db.selectFrom("knowledge_point")
        .select(["id", "kind"])
        .where("catalogue_status", "=", "active")
        .orderBy("canonical_key", "asc")
        .execute(),
      catch: (cause) => new GraduateAllProgressError({
        message: "Failed to load active knowledge points.",
        cause,
      }),
    });
    if (activePoints.length === 0) {
      return yield* Effect.fail(new GraduateAllProgressError({
        message: "No active knowledge points exist to graduate.",
      }));
    }

    const result = yield* Effect.tryPromise({
      try: () => db.transaction().execute(async (trx) => {
        const nextReview = addDays(now, GRADUATED_STABILITY_DAYS);
        const hlc = makeGraduateHlc(now);
        const rows: NewSrsCard[] = activePoints.map((point) => ({
          id: crypto.randomUUID() as SrsCardId,
          user_id: user.id as UserId,
          knowledge_point_id: point.id as KnowledgePointId,
          grammar_point_id: point.kind === "grammar" ? point.id as KnowledgePointId : null,
          ease_factor: 2.5,
          repetitions: GRADUATED_REPETITIONS,
          interval_days: GRADUATED_STABILITY_DAYS,
          next_review: nextReview,
          difficulty: 3,
          stability: GRADUATED_STABILITY_DAYS,
          last_reviewed_at: now,
          participation_status: "active",
          learning_state: "stable",
          introduced_at: now,
          checkout_due: false,
          created_at: now,
          updated_at: now,
          hlc,
        }));

        await trx.insertInto("srs_card")
          .values(rows)
          .onConflict((conflict) => conflict
            .columns(["user_id", "knowledge_point_id"])
            .doUpdateSet({
              ease_factor: 2.5,
              repetitions: GRADUATED_REPETITIONS,
              interval_days: GRADUATED_STABILITY_DAYS,
              next_review: nextReview,
              difficulty: 3,
              stability: GRADUATED_STABILITY_DAYS,
              last_reviewed_at: now,
              participation_status: "active",
              learning_state: "stable",
              checkout_due: false,
              updated_at: now,
              hlc,
            }))
          .execute();

        const nextEpochId = crypto.randomUUID() as SyncEpochId;
        await trx.updateTable("sync_epoch")
          .set({ id: nextEpochId, created_at: now })
          .execute();

        return {
          userId: user.id,
          graduatedCount: rows.length,
          nextReview: nextReview.toISOString(),
          hlc,
          epochId: nextEpochId,
        };
      }),
      catch: (cause) => new GraduateAllProgressError({
        message: `Failed to graduate all knowledge points for email=${normalizedEmail}.`,
        cause,
      }),
    });

    yield* Effect.logInfo(
      `[GraduateAllProgress] Graduated ${result.graduatedCount} active knowledge points for user_id=${result.userId}; nextReview=${result.nextReview}; epoch=${result.epochId}.`,
    );
    return result;
  });

if (import.meta.main) {
  const targetEmail = Bun.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--"))?.trim();
  const confirmed = Bun.argv.includes("--confirm");
  const program = Effect.gen(function* () {
    if (!targetEmail) {
      return yield* Effect.fail(new GraduateAllProgressError({
        message: "Missing learner email. Run: bun run db:graduate-all -- learner@example.com --confirm",
      }));
    }
    if (!confirmed) {
      return yield* Effect.fail(new GraduateAllProgressError({
        message: "Refusing to change study history without --confirm. This command marks every active knowledge point as Graduated.",
      }));
    }
    yield* Effect.logInfo(`[GraduateAllProgress] Destructive learner-scoped update confirmed for email=${targetEmail}.`);
    return yield* graduateAllKnowledgePoints(targetEmail);
  });

  void Effect.runPromiseExit(program).then((exit) => {
    void closeDb().then(() => {
      if (Exit.isSuccess(exit)) {
        console.info(`✅ Graduated ${exit.value.graduatedCount} knowledge points.`);
        console.info("Before reopening Gafu, clear this local Gafu site's browser storage so stale offline writes cannot replace the manual reset.");
        console.info("Then reopen Gafu and log in; the forced full sync will restore the graduated progress from the server.");
        process.exit(0);
      }

      console.error("");
      console.error("❌ Graduate-all command failed:");
      console.error("");
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    });
  });
}
