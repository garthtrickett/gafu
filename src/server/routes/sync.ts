import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { db } from "../../db/client.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError, AuthDatabaseError } from "../../features/auth/Errors.ts";
import type { UserId, SrsCardId, GrammarPointId } from "../../types/index.ts";

interface RecordReviewPayload {
  readonly grammarPointId?: string;
  readonly grammar_point_id?: string;
  readonly easeFactor?: number;
  readonly ease_factor?: number;
  readonly repetitions: number;
  readonly intervalDays?: number;
  readonly interval_days?: number;
  readonly nextReview?: string;
  readonly next_review?: string;
}

export const syncRoutes = new Elysia({ prefix: "/api/sync" })
  .use(effectPlugin)
  .get(
    "/pull",
    async ({ query, headers, set, runEffect }) => {
      const pullEffect = Effect.gen(function* () {
        const since = query.since ? Number(query.since) : 0;
        yield* Effect.logInfo(`[Sync:Pull] Executing pull requests. sinceTimestamp=${since}`);

        const authHeader = headers["authorization"];
        yield* Effect.logInfo(`[Sync:Pull] Received Authorization header: "${authHeader}"`);

        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        yield* Effect.logInfo(`[Sync:Pull] Parsed token value: "${token}"`);

        if (!token || token === "null" || token === "undefined" || token.trim() === "") {
          yield* Effect.logError(`[Sync:Pull] Unauthorized access: Missing, null, or empty authorization token "${token}"`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(`[Sync:Pull] Authorized session for subscriber: ${user.email} (ID: ${user.id})`);

        const sinceDate = new Date(since);

        // Retrieve decks updated since the client's last checkpoint date
        yield* Effect.logInfo(`[Sync:Pull] Fetching decks updated after ${sinceDate.toISOString()}`);
        const decks = yield* Effect.tryPromise({
          try: () => db.selectFrom("deck")
            .selectAll()
            .where("updated_at", ">", sinceDate)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${decks.length} matching decks from database`);

        // Retrieve SRS cards updated since client last pulled matching this user
        yield* Effect.logInfo(`[Sync:Pull] Fetching user SRS updates updated after ${sinceDate.toISOString()}`);
        const srsCards = yield* Effect.tryPromise({
          try: () => db.selectFrom("srs_card")
            .selectAll()
            .where("user_id", "=", user.id as UserId)
            .where("updated_at", ">", sinceDate)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${srsCards.length} matching SRS reviews from database`);

        // Retrieve global grammar points catalog updated since last pull
        yield* Effect.logInfo(`[Sync:Pull] Fetching global grammar points updated after ${sinceDate.toISOString()}`);
        const grammarPoints = yield* Effect.tryPromise({
          try: () => db.selectFrom("grammar_point")
            .selectAll()
            .where("updated_at", ">", sinceDate)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${grammarPoints.length} matching grammar points from database`);

        const decksResult = decks.map(d => ({
          id: d.id,
          name: d.name,
          category: d.category,
          content: d.content
        }));

        const srsUpdatesResult = srsCards.map(c => ({
          id: c.id,
          grammarPointId: c.grammar_point_id,
          easeFactor: c.ease_factor,
          repetitions: c.repetitions,
          intervalDays: c.interval_days,
          nextReview: c.next_review.toISOString()
        }));

                const grammarPointsResult = grammarPoints.map(gp => ({
          id: gp.id,
          formal_name: gp.formal_name,
          base_meaning: gp.base_meaning,
          difficulty_level: gp.difficulty_level
        }));

        // Retrieve user preferences (or initialize defaults on-the-fly)
        yield* Effect.logInfo(`[Sync:Pull] Fetching user preferences for user_id=${user.id}`);
        let userPreference = yield* Effect.tryPromise({
          try: () => db.selectFrom("user_preference")
            .selectAll()
            .where("user_id", "=", user.id as UserId)
            .executeTakeFirst(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });

        if (!userPreference) {
          yield* Effect.logInfo(`[Sync:Pull] Seed default preferences for user_id=${user.id}`);
          userPreference = yield* Effect.tryPromise({
            try: () => db.insertInto("user_preference")
              .values({
                user_id: user.id as UserId,
                daily_review_limit: 50,
                daily_new_rule_limit: 5,
                created_at: new Date(),
                updated_at: new Date()
              })
              .returningAll()
              .executeTakeFirstOrThrow(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
        }

        const serverTimestamp = Date.now();
        yield* Effect.logInfo(`[Sync:Pull] Complete. generatedServerTimestamp=${serverTimestamp}`);

        return {
          serverTimestamp,
          decks: decksResult,
          srsUpdates: srsUpdatesResult,
          grammarPoints: grammarPointsResult,
          userPreference: {
            dailyReviewLimit: userPreference.daily_review_limit,
            dailyNewRuleLimit: userPreference.daily_new_rule_limit
          }
        };
      });

      const result = await runEffect(Effect.either(pullEffect));
      if (result._tag === "Left") {
        const error = result.left;
        const errorMessage = error instanceof Error ? error.message : (typeof error === "string" ? error : (JSON.stringify(error) ?? "Unknown error"));
        await runEffect(
          Effect.logError(
            `[Sync:Pull] Pull request failed: ${errorMessage}`
          )
        );
        if (error instanceof InvalidCredentialsError) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
        set.status = 500;
        return { error: "Internal Server Error", message: errorMessage };
      }
      return result.right;
    },
    {
      query: t.Object({
        since: t.Optional(t.String())
      })
    }
  )
  .post(
    "/push",
    async ({ body, headers, set, runEffect }) => {
      const pushEffect = Effect.gen(function* () {
        yield* Effect.logInfo(`[Sync:Push] Processing transaction. txId=${body.id}, type=${body.type}`);

        const authHeader = headers["authorization"];
        yield* Effect.logInfo(`[Sync:Push] Received Authorization header: "${authHeader}"`);

        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        yield* Effect.logInfo(`[Sync:Push] Parsed token value: "${token}"`);

        if (!token || token === "null" || token === "undefined" || token.trim() === "") {
          yield* Effect.logError(`[Sync:Push] Unauthorized access: Missing, null, or empty authorization token "${token}"`);
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(`[Sync:Push] Authorized session for subscriber: ${user.email} (ID: ${user.id})`);

                if (body.type === "record_review") {
          const payload = body.payload as RecordReviewPayload;
          const grammarPointId = payload.grammarPointId ?? payload.grammar_point_id;
          const easeFactor = payload.easeFactor ?? payload.ease_factor;
          const repetitions = payload.repetitions;
          const intervalDays = payload.intervalDays ?? payload.interval_days;
          const nextReview = payload.nextReview ?? payload.next_review;

                    if (!grammarPointId || !nextReview) {
            yield* Effect.logError("[Sync:Push] Bad request: Card review transaction payload is missing parameters");
            return yield* Effect.fail(new Error("Missing parameters in review payload"));
          }

          // Validate that the grammarPointId is a valid UUID to prevent PostgreSQL casting crashes
          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!UUID_REGEX.test(grammarPointId)) {
            yield* Effect.logWarning(`[Sync:Push] grammarPointId="${grammarPointId}" is not a valid UUID. Discarding review to clear outbox queue.`);
            return { success: true };
          }

          yield* Effect.logInfo(`[Sync:Push] Recording review grammarPointId=${grammarPointId}. easeFactor=${easeFactor}, reps=${repetitions}, nextReview=${nextReview}`);

          // Verify grammar_point exists first to prevent foreign key violations from legacy/obsolete IDs
          const gpExists = yield* Effect.tryPromise({ 
            try: () => db.selectFrom("grammar_point")
              .select("id")
              .where("id", "=", grammarPointId as GrammarPointId)
              .executeTakeFirst(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });

          if (!gpExists) {
            yield* Effect.logWarning(`[Sync:Push] grammarPointId=${grammarPointId} not found in database. Discarding review to clear outbox queue.`);
            return { success: true };
          }

          yield* Effect.tryPromise({ 
            try: () => db.insertInto("srs_card")
              .values({
                id: crypto.randomUUID() as SrsCardId,
                user_id: user.id as UserId,
                grammar_point_id: grammarPointId as GrammarPointId,
                ease_factor: easeFactor,
                repetitions: repetitions,
                interval_days: intervalDays,
                next_review: new Date(nextReview),
                created_at: new Date(),
                updated_at: new Date()
              })
              .onConflict((oc) => oc
                .columns(["user_id", "grammar_point_id"])
                .doUpdateSet({
                  ease_factor: easeFactor,
                  repetitions: repetitions,
                  interval_days: intervalDays,
                  next_review: new Date(nextReview),
                  updated_at: new Date()
                })
              )
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Review recorded for grammarPointId=${grammarPointId}`);
        } else if (body.type === "update_preferences") {
          const payload = body.payload as { dailyReviewLimit?: number; dailyNewRuleLimit?: number };
          const dailyReviewLimit = payload.dailyReviewLimit;
          const dailyNewRuleLimit = payload.dailyNewRuleLimit;

          if (dailyReviewLimit === undefined || dailyNewRuleLimit === undefined) {
            yield* Effect.logError("[Sync:Push] Bad request: update_preferences transaction payload is missing parameters");
            return yield* Effect.fail(new Error("Missing parameters in update_preferences payload"));
          }

          yield* Effect.logInfo(`[Sync:Push] Updating preferences for user_id=${user.id}. dailyReviewLimit=${dailyReviewLimit}, dailyNewRuleLimit=${dailyNewRuleLimit}`);

          yield* Effect.tryPromise({ 
            try: () => db.insertInto("user_preference")
              .values({
                user_id: user.id as UserId,
                daily_review_limit: dailyReviewLimit,
                daily_new_rule_limit: dailyNewRuleLimit,
                created_at: new Date(),
                updated_at: new Date()
              })
              .onConflict((oc) => oc
                .column("user_id")
                .doUpdateSet({
                  daily_review_limit: dailyReviewLimit,
                  daily_new_rule_limit: dailyNewRuleLimit,
                  updated_at: new Date()
                })
              )
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Preferences updated successfully for user_id=${user.id}`);
        } else if (body.type === "toggle_skin") {
          yield* Effect.logInfo(`[Sync:Push] Processing skin toggle. payload=${JSON.stringify(body.payload)}`);
        } else if (body.type === "unlock_deck") {
          yield* Effect.logInfo(`[Sync:Push] Processing deck unlock. payload=${JSON.stringify(body.payload)}`);
        } else {
          yield* Effect.logWarning(`[Sync:Push] Unrecognized transaction type: ${body.type}`);
        }

        return { success: true };
      });

      const result = await runEffect(Effect.either(pushEffect));
      if (result._tag === "Left") {
        const error = result.left;
        const errorMessage = error instanceof Error ? error.message : (typeof error === "string" ? error : (JSON.stringify(error) ?? "Unknown error"));
        await runEffect(
          Effect.logError(
            `[Sync:Push] Push request failed: ${errorMessage}`
          )
        );
        if (error instanceof InvalidCredentialsError) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
        set.status = 500;
        return { error: "Internal Server Error", message: errorMessage };
      }
      return result.right;
    },
    {
      body: t.Object({
        id: t.String(),
        type: t.String(),
        payload: t.Any(),
        timestamp: t.Number()
      })
    }
  );
