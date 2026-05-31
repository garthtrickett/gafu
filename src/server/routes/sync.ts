import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { db } from "../../db/client.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError, AuthDatabaseError } from "../../features/auth/Errors.ts";
import { initHlc, receiveHlc, packHlc } from "../../lib/shared/hlc.ts";
import type { UserId, SrsCardId, GrammarPointId } from "../../types/index.ts";
import { OutboxTransactionSchema } from "../../lib/shared/sync-schemas.ts";
import { Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import { AuthError } from "../../lib/shared/auth.ts";

export const syncRoutes = new Elysia({ prefix: "/api/sync" })
  .use(effectPlugin)
  .get(
    "/pull",
    async ({ query, headers, set, runEffect }) => {
      const pullEffect = Effect.gen(function* () {
        const since = query.since || "0000000000000:0000:initial";
        yield* Effect.logInfo(`[Sync:Pull] Executing pull requests. sinceHlc=${since}`);

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

        const op = since === "0000000000000:0000:initial" ? ">=" : ">";

        // Retrieve decks updated lexicographically after the client's since HLC
        yield* Effect.logInfo(`[Sync:Pull] Fetching decks updated after HLC: ${since}`);
        const decks = yield* Effect.tryPromise({
          try: () => db.selectFrom("deck")
            .selectAll()
            .where("hlc", op, since)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${decks.length} matching decks from database`);

        // Retrieve SRS cards updated lexicographically after client since HLC
        yield* Effect.logInfo(`[Sync:Pull] Fetching user SRS updates updated after HLC: ${since}`);
        const srsCards = yield* Effect.tryPromise({
          try: () => db.selectFrom("srs_card")
            .selectAll()
            .where("user_id", "=", user.id as UserId)
            .where("hlc", op, since)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${srsCards.length} matching SRS reviews from database`);

        // Retrieve global grammar points catalog updated lexicographically after client since HLC
        yield* Effect.logInfo(`[Sync:Pull] Fetching global grammar points updated after HLC: ${since}`);
        const grammarPoints = yield* Effect.tryPromise({
          try: () => db.selectFrom("grammar_point")
            .selectAll()
            .where("hlc", op, since)
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
                daily_review_limit: 20,
                daily_new_rule_limit: 3,
                created_at: new Date(),
                updated_at: new Date(),
                hlc: "0000000000000:0000:initial"
              })
              .returningAll()
              .executeTakeFirstOrThrow(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
        }

        const showPreference = userPreference && (op === ">=" ? userPreference.hlc >= since : userPreference.hlc > since);
        const serverTimestamp = Date.now();
        yield* Effect.logInfo(`[Sync:Pull] Complete. generatedServerTimestamp=${serverTimestamp}`);

        return {
          serverTimestamp,
          serverHlc: packHlc(initHlc("server", serverTimestamp)),
          decks: decksResult,
          srsUpdates: srsUpdatesResult,
          grammarPoints: grammarPointsResult,
          userPreference: showPreference ? {
            dailyReviewLimit: userPreference.daily_review_limit,
            dailyNewRuleLimit: userPreference.daily_new_rule_limit
          } : undefined
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
        if (error instanceof InvalidCredentialsError || (error && typeof error === "object" && "_tag" in error && (error._tag === "Unauthorized" || error._tag === "Forbidden" || (error as { _tag?: string })._tag === "AuthError"))) {
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

        const decodedTx = yield* Schema.decodeUnknown(OutboxTransactionSchema)(body).pipe(
          Effect.mapError(
            (parseError) =>
              new AuthError({
                _tag: "BadRequest",
                message: `Invalid outbox transaction payload: ${TreeFormatter.formatError(parseError)}`,
              })
          )
        );

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

        // Clock Convergence: Merge server wall clock with client's incoming HLC
        const clientHlc = decodedTx.hlc;
        const serverBase = initHlc("server", Date.now());
        const converged = receiveHlc(serverBase, clientHlc, Date.now());
        const convergedPacked = packHlc(converged);

        yield* Effect.logInfo(`[Sync:Push] HLC converged: client=${clientHlc} -> converged=${convergedPacked}`);

        if (decodedTx.type === "record_review") {
          const payload = decodedTx.payload;
          const grammarPointId = payload.grammarPointId;
          const easeFactor = payload.easeFactor;
          const repetitions = payload.repetitions;
          const intervalDays = payload.intervalDays;
          const nextReview = payload.nextReview;

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
                updated_at: new Date(),
                hlc: convergedPacked
              })
              .onConflict((oc) => oc
                .columns(["user_id", "grammar_point_id"])
                .doUpdateSet({
                  ease_factor: easeFactor,
                  repetitions: repetitions,
                  interval_days: intervalDays,
                  next_review: new Date(nextReview),
                  updated_at: new Date(),
                  hlc: convergedPacked
                })
              )
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Review recorded for grammarPointId=${grammarPointId}`);
        } else if (decodedTx.type === "update_preferences") {
          const payload = decodedTx.payload;
          const dailyReviewLimit = payload.dailyReviewLimit;
          const dailyNewRuleLimit = payload.dailyNewRuleLimit;

          yield* Effect.logInfo(`[Sync:Push] Updating preferences for user_id=${user.id}. dailyReviewLimit=${dailyReviewLimit}, dailyNewRuleLimit=${dailyNewRuleLimit}`);

          yield* Effect.tryPromise({ 
            try: () => db.insertInto("user_preference")
              .values({
                user_id: user.id as UserId,
                daily_review_limit: dailyReviewLimit,
                daily_new_rule_limit: dailyNewRuleLimit,
                created_at: new Date(),
                updated_at: new Date(),
                hlc: convergedPacked
              })
              .onConflict((oc) => oc
                .column("user_id")
                .doUpdateSet({
                  daily_review_limit: dailyReviewLimit,
                  daily_new_rule_limit: dailyNewRuleLimit,
                  updated_at: new Date(),
                  hlc: convergedPacked
                })
              )
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Preferences updated successfully for user_id=${user.id}`);
        } else if (decodedTx.type === "toggle_skin") {
          yield* Effect.logInfo(`[Sync:Push] Processing skin toggle. payload=${JSON.stringify(decodedTx.payload)}`);
        } else if (decodedTx.type === "unlock_deck") {
          yield* Effect.logInfo(`[Sync:Push] Processing deck unlock. payload=${JSON.stringify(decodedTx.payload)}`);
        } else {
          yield* Effect.logWarning(`[Sync:Push] Unrecognized transaction type: ${(decodedTx as any).type}`);
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
        if (error && typeof error === "object" && "_tag" in error && error._tag === "BadRequest") {
          set.status = 400;
          return { error: "Bad Request", message: (error as { readonly message: string }).message };
        }
        if (error instanceof InvalidCredentialsError || (error && typeof error === "object" && "_tag" in error && (error._tag === "Unauthorized" || error._tag === "Forbidden" || (error as { _tag?: string })._tag === "AuthError"))) {
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
        hlc: t.String()
      })
    }
  );
