import "dotenv/config";
import { Cause, Data, Effect, Exit } from "effect";
import { closeDb, db } from "./client";
import type { GrammarPointId, NewSrsCard, SrsCardId, UserId } from "../types";

const MASTERED_TARGET_COUNT = 270;
const LEARNING_TARGET_COUNT = 25;

type GrammarPointRestoreRow = {
  readonly id: GrammarPointId;
  readonly formal_name: string;
  readonly sequence_order: number;
};

class ProgressRestoreSeedError extends Data.TaggedError("ProgressRestoreSeedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const partitionProgressRestoreCatalog = (catalog: ReadonlyArray<GrammarPointRestoreRow>) => {
  const targetWindow = catalog.slice(0, MASTERED_TARGET_COUNT + LEARNING_TARGET_COUNT);

  return {
    mastered: targetWindow.slice(0, MASTERED_TARGET_COUNT),
    learning: targetWindow.slice(MASTERED_TARGET_COUNT),
    ignoredAfterLearningWindow: catalog.slice(MASTERED_TARGET_COUNT + LEARNING_TARGET_COUNT),
  };
};

const getTargetEmail = (): string | null => {
  const cliEmail = Bun.argv.slice(2).find((arg) => arg !== "--" && !arg.startsWith("--"));
  const rawEmail = cliEmail ?? process.env.RESTORE_PROGRESS_EMAIL ?? null;
  const email = rawEmail?.trim().toLowerCase();
  return email && email.length > 0 ? email : null;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const makeRestoreHlc = (): string => `${String(Date.now()).padStart(13, "0")}:0000:restore-progress`;

export const restoreFirst270MasteredProgress = (targetEmail: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[ProgressRestoreSeed] Starting one-time progress restore for email=${targetEmail}`);

    const user = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("user")
          .select(["id", "email"])
          .where("email", "=", targetEmail)
          .executeTakeFirst(),
      catch: (cause) => new ProgressRestoreSeedError({ message: "Failed to look up restore user.", cause }),
    });

    if (!user) {
      return yield* Effect.fail(
        new ProgressRestoreSeedError({
          message: `No user exists with email=${targetEmail}. Pass the learner email as the first arg or set RESTORE_PROGRESS_EMAIL.`,
        }),
      );
    }

    yield* Effect.logInfo(`[ProgressRestoreSeed] Found target user_id=${user.id}`);

    const orderedGrammarPoints = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("grammar_point")
          .select(["id", "formal_name", "sequence_order"])
          .orderBy("sequence_order", "asc")
          .orderBy("formal_name", "asc")
          .execute(),
      catch: (cause) => new ProgressRestoreSeedError({ message: "Failed to load ordered grammar catalog.", cause }),
    });

    const minimumRequiredCatalogCount = MASTERED_TARGET_COUNT + LEARNING_TARGET_COUNT;
    if (orderedGrammarPoints.length < minimumRequiredCatalogCount) {
      return yield* Effect.fail(
        new ProgressRestoreSeedError({
          message: `Catalog only has ${orderedGrammarPoints.length} grammar points, but restore needs at least ${minimumRequiredCatalogCount}. Run the catalog seed/migration first or lower the restore targets.`,
        }),
      );
    }

    const { mastered, learning, ignoredAfterLearningWindow } = partitionProgressRestoreCatalog(orderedGrammarPoints);
    const now = new Date();
    const learningLastReviewedAt = addDays(now, -1);
    const masteredNextReview = addDays(now, 7);
    const learningNextReview = now;
    const hlc = makeRestoreHlc();

    yield* Effect.logInfo(
      `[ProgressRestoreSeed] Prepared restore partitions: mastered=${mastered.length}, learning=${learning.length}, untouchedAfterWindow=${ignoredAfterLearningWindow.length}`,
    );

    yield* Effect.logInfo(`[ProgressRestoreSeed] Clearing existing SRS cards for target user_id=${user.id}`);
    yield* Effect.tryPromise({
      try: () => db.deleteFrom("srs_card").where("user_id", "=", user.id).execute(),
      catch: (cause) => new ProgressRestoreSeedError({ message: "Failed to clear existing target-user SRS rows.", cause }),
    });

    const masteredRows: NewSrsCard[] = mastered.map((point) => ({
      id: crypto.randomUUID() as SrsCardId,
      user_id: user.id as UserId,
      grammar_point_id: point.id,
      ease_factor: 2.5,
      repetitions: 3,
      interval_days: 7,
      next_review: masteredNextReview,
      created_at: now,
      updated_at: now,
      hlc,
      difficulty: 4.0,
      stability: 7.0,
      last_reviewed_at: now,
    }));

    const learningRows: NewSrsCard[] = learning.map((point) => ({
      id: crypto.randomUUID() as SrsCardId,
      user_id: user.id as UserId,
      grammar_point_id: point.id,
      ease_factor: 2.5,
      repetitions: 1,
      interval_days: 1,
      next_review: learningNextReview,
      created_at: now,
      updated_at: now,
      hlc,
      difficulty: 5.0,
      stability: 1.0,
      last_reviewed_at: learningLastReviewedAt,
    }));

    const restoreRows = [...masteredRows, ...learningRows];

    yield* Effect.logInfo(`[ProgressRestoreSeed] Inserting ${restoreRows.length} restored SRS cards for user_id=${user.id}`);

    yield* Effect.tryPromise({
      try: () => db.insertInto("srs_card").values(restoreRows).execute(),
      catch: (cause) => new ProgressRestoreSeedError({ message: "Failed to insert restored progress rows.", cause }),
    });

    yield* Effect.logInfo(
      `[ProgressRestoreSeed] Restore complete. Expected UI counts: mastered=${mastered.length}, learning=${learning.length}, untouched=${ignoredAfterLearningWindow.length}. HLC=${hlc}`,
    );
  });

if (import.meta.main) {
  const targetEmail = getTargetEmail();

  const seedProgram = Effect.gen(function* () {
    if (!targetEmail) {
      return yield* Effect.fail(
        new ProgressRestoreSeedError({
          message: "Missing target learner email. Run: bun run db:restore-progress -- learner@example.com",
        }),
      );
    }

    yield* restoreFirst270MasteredProgress(targetEmail);
  });

  void Effect.runPromiseExit(seedProgram).then((exit) => {
    void closeDb().then(() => {
      if (Exit.isSuccess(exit)) {
        console.info("🌱 Progress restore seed completed.");
        process.exit(0);
      }

      console.error("");
      console.error("❌ Progress restore seed failed:");
      console.error("");
      console.error(Cause.pretty(exit.cause));
      process.exit(1);
    });
  });
}
