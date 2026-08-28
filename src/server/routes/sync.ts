import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { db } from "../../db/client.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError, AuthDatabaseError } from "../../features/auth/Errors.ts";
import { initHlc, receiveHlc, packHlc } from "../../lib/shared/hlc.ts";
import type { UserId, SrsCardId, KnowledgePointId } from "../../types/index.ts";
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
        yield* Effect.logInfo(`[Sync:Pull] Executing pull requests. sinceHlc=${since}, clientEpochId=${query.epochId}`);

        const authHeader = headers["authorization"];
        const token = extractBearerToken(authHeader);
        yield* Effect.logInfo(
          `[Sync:Pull] Authorization header present=${Boolean(authHeader)} token=${redactTokenForLog(token)}`
        );

        if (!token || token === "null" || token === "undefined" || token.trim() === "") {
          yield* Effect.logError("[Sync:Pull] Unauthorized access: Missing, null, or empty authorization token.");
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* requirePersistedSyncUser("Pull", user);
        yield* Effect.logInfo(`[Sync:Pull] Authorized session for subscriber: ${user.email} (ID: ${user.id})`);

        // Retrieve active database sync epoch
        yield* Effect.logInfo(`[Sync:Pull] Fetching active database sync epoch...`);
        const activeEpoch = yield* Effect.tryPromise({
          try: () => db.selectFrom("sync_epoch")
            .selectAll()
            .executeTakeFirstOrThrow(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        const activeEpochId = activeEpoch.id;
        yield* Effect.logInfo(`[Sync:Pull] Active database sync epoch is: ${activeEpochId}`);

        const clientEpochId = query.epochId;
        const serverTimestamp = Date.now();
        const serverHlc = packHlc(initHlc("server", serverTimestamp));

        // Epoch Verification: If client epoch doesn't match active epoch, trigger client auto-heal
        if (!clientEpochId || clientEpochId !== activeEpochId) {
          yield* Effect.logWarning(`[Sync:Pull] Sync Epoch mismatch detected! Client epochId: "${clientEpochId}", active server epochId: "${activeEpochId}". Directing client to reset Sync state.`);
          return {
            resetSync: true,
            epochId: activeEpochId,
            serverTimestamp,
            serverHlc,
            decks: [],
            srsUpdates: [],
            grammarPoints: [],
            knowledgePoints: []
          };
        }

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

        const knowledgePoints = yield* Effect.tryPromise({
          try: () => db.selectFrom("knowledge_point")
            .leftJoin("grammar_point", "grammar_point.id", "knowledge_point.id")
            .leftJoin("vocabulary_point", "vocabulary_point.knowledge_point_id", "knowledge_point.id")
            .select([
              "knowledge_point.id",
              "knowledge_point.kind",
              "knowledge_point.canonical_key",
              "knowledge_point.scope",
              "knowledge_point.owner_user_id",
              "knowledge_point.catalogue_status",
              "knowledge_point.created_from",
              "knowledge_point.confidence",
              "knowledge_point.hlc",
              "grammar_point.formal_name",
              "grammar_point.base_meaning",
              "grammar_point.difficulty_level",
              "vocabulary_point.lemma",
              "vocabulary_point.reading",
              "vocabulary_point.part_of_speech",
              "vocabulary_point.sense_key",
              "vocabulary_point.meaning",
              "vocabulary_point.register",
            ])
            .where("knowledge_point.hlc", op, since)
            .where((eb) => eb.or([
              eb("knowledge_point.scope", "=", "curated"),
              eb("knowledge_point.owner_user_id", "=", user.id as UserId),
            ]))
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });

        const decksResult = decks.map(d => ({
          id: d.id,
          name: d.name,
          category: d.category,
          content: d.content,
          hlc: d.hlc
        }));

        const srsUpdatesResult = srsCards.map(c => ({
          id: c.id,
          knowledgePointId: c.knowledge_point_id,
          easeFactor: c.ease_factor,
          repetitions: c.repetitions,
          intervalDays: c.interval_days,
          nextReview: c.next_review.toISOString(),
          difficulty: Number(c.difficulty),
          stability: Number(c.stability),
          lastReviewedAt: c.last_reviewed_at ? c.last_reviewed_at.toISOString() : null,
          participationStatus: c.participation_status,
          learningState: c.learning_state,
          introducedAt: c.introduced_at ? c.introduced_at.toISOString() : null,
          hlc: c.hlc
        }));

        const grammarPointsResult = grammarPoints.map(gp => ({
          id: gp.id,
          formal_name: gp.formal_name,
          base_meaning: gp.base_meaning,
          difficulty_level: gp.difficulty_level,
          hlc: gp.hlc
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
                enforce_mastery_gates: true,
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
        yield* Effect.logInfo(`[Sync:Pull] Complete. generatedServerTimestamp=${serverTimestamp}`);

        return {
          serverTimestamp,
          serverHlc,
          epochId: activeEpochId,
          decks: decksResult,
          srsUpdates: srsUpdatesResult,
          grammarPoints: grammarPointsResult,
          knowledgePoints,
          userPreference: showPreference ? {
            dailyReviewLimit: userPreference.daily_review_limit,
            dailyNewRuleLimit: userPreference.daily_new_rule_limit,
            enforceMasteryGates: userPreference.enforce_mastery_gates,
            learnerTimeZone: userPreference.learner_time_zone,
            hlc: userPreference.hlc
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
        since: t.Optional(t.String()),
        epochId: t.Optional(t.String())
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
                message: `Invalid outbox transaction payload: ${TreeFormatter.formatErrorSync(parseError)}`,
              })
          )
        );

        const authHeader = headers["authorization"];
        const token = extractBearerToken(authHeader);
        yield* Effect.logInfo(
          `[Sync:Push] Authorization header present=${Boolean(authHeader)} token=${redactTokenForLog(token)}`
        );

        if (!token || token === "null" || token === "undefined" || token.trim() === "") {
          yield* Effect.logError("[Sync:Push] Unauthorized access: Missing, null, or empty authorization token.");
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* requirePersistedSyncUser("Push", user);
        yield* Effect.logInfo(`[Sync:Push] Authorized session for subscriber: ${user.email} (ID: ${user.id})`);

        // Clock Convergence: Merge server wall clock with client's incoming HLC
        const clientHlc = decodedTx.hlc;
        const serverBase = initHlc("server", Date.now());
        const converged = receiveHlc(serverBase, clientHlc, Date.now());
        const convergedPacked = packHlc(converged);

        yield* Effect.logInfo(`[Sync:Push] HLC converged: client=${clientHlc} -> converged=${convergedPacked}`);

        if (decodedTx.type === "record_review") {
          const payload = decodedTx.payload;
          const knowledgePointId = payload.knowledgePointId;
          const easeFactor = payload.easeFactor;
          const repetitions = payload.repetitions;
          const intervalDays = payload.intervalDays;
          const nextReview = payload.nextReview;
          const difficulty = payload.difficulty;
          const stability = payload.stability;
          const lastReviewedAt = payload.lastReviewedAt;

          yield* Effect.logInfo(`[Sync:Push] Recording review knowledgePointId=${knowledgePointId}. easeFactor=${easeFactor}, reps=${repetitions}, nextReview=${nextReview}`);

          const knowledgePoint = yield* Effect.tryPromise({
            try: () => db.selectFrom("knowledge_point")
              .select(["id", "kind", "catalogue_status"])
              .where("id", "=", knowledgePointId as KnowledgePointId)
              .executeTakeFirst(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });

          if (!knowledgePoint || knowledgePoint.catalogue_status !== "active") {
            yield* Effect.logWarning(`[Sync:Push] knowledgePointId=${knowledgePointId} is missing or inactive. Discarding review to clear the compatibility outbox queue.`);
            return { success: true };
          }

          yield* Effect.tryPromise({ 
            try: () => db.insertInto("srs_card")
              .values({
                id: crypto.randomUUID() as SrsCardId,
                user_id: user.id as UserId,
                knowledge_point_id: knowledgePointId as KnowledgePointId,
                grammar_point_id: knowledgePoint.kind === "grammar" ? knowledgePointId as KnowledgePointId : null,
                ease_factor: easeFactor,
                repetitions: repetitions,
                interval_days: intervalDays,
                next_review: new Date(nextReview),
                difficulty: difficulty,
                stability: stability,
                last_reviewed_at: lastReviewedAt ? new Date(lastReviewedAt) : null,
                learning_state: repetitions > 0 ? "learning" : "introduced",
                introduced_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
                hlc: convergedPacked
              })
              .onConflict((oc) => oc
                .columns(["user_id", "knowledge_point_id"])
                .doUpdateSet({
                  ease_factor: easeFactor,
                  repetitions: repetitions,
                  interval_days: intervalDays,
                  next_review: new Date(nextReview),
                  difficulty: difficulty,
                  stability: stability,
                  last_reviewed_at: lastReviewedAt ? new Date(lastReviewedAt) : null,
                  learning_state: stability >= 21 ? "stable" : "learning",
                  updated_at: new Date(),
                  hlc: convergedPacked
                })
              )
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Review recorded for knowledgePointId=${knowledgePointId}`);
        } else if (decodedTx.type === "update_preferences") {
          const payload = decodedTx.payload;
          const dailyReviewLimit = payload.dailyReviewLimit;
          const dailyNewRuleLimit = payload.dailyNewRuleLimit;
          const enforceMasteryGates = payload.enforceMasteryGates !== undefined ? payload.enforceMasteryGates : true;
          const learnerTimeZone = payload.learnerTimeZone;

          yield* Effect.logInfo(`[Sync:Push] Updating preferences for user_id=${user.id}. dailyReviewLimit=${dailyReviewLimit}, dailyNewRuleLimit=${dailyNewRuleLimit}, enforceMasteryGates=${enforceMasteryGates}`);

          yield* Effect.tryPromise({ 
            try: () => db.insertInto("user_preference")
              .values({
                user_id: user.id as UserId,
                daily_review_limit: dailyReviewLimit,
                daily_new_rule_limit: dailyNewRuleLimit,
                enforce_mastery_gates: enforceMasteryGates,
                learner_time_zone: learnerTimeZone,
                created_at: new Date(),
                updated_at: new Date(),
                hlc: convergedPacked
              })
              .onConflict((oc) => oc
                .column("user_id")
                .doUpdateSet({
                  daily_review_limit: dailyReviewLimit,
                  daily_new_rule_limit: dailyNewRuleLimit,
                  enforce_mastery_gates: enforceMasteryGates,
                  learner_time_zone: learnerTimeZone,
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
          yield* Effect.logWarning(`[Sync:Push] Unrecognized transaction type: ${(decodedTx as { readonly type: string }).type}`);
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
          const message = "message" in error && typeof error.message === "string" ? error.message : "Bad Request";
          return { error: "Bad Request", message };
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

function redactTokenForLog(token: string | null): string {
  if (!token) {
    return "null";
  }

  if (token.length <= 20) {
    return `${token.slice(0, 4)}...redacted`;
  }

  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function requirePersistedSyncUser(
  scope: "Pull" | "Push",
  user: { readonly id: string; readonly email: string }
) {
  return Effect.gen(function* () {
    yield* Effect.logInfo(`[Sync:${scope}] Verifying token subject exists in user table. user_id=${user.id}`);

    const persistedUser = yield* Effect.tryPromise({
      try: () =>
        db
          .selectFrom("user")
          .select(["id", "email"])
          .where("id", "=", user.id as UserId)
          .executeTakeFirst(),
      catch: (cause) => new AuthDatabaseError({ cause }),
    });

    if (!persistedUser) {
      yield* Effect.logWarning(
        `[Sync:${scope}] Rejecting valid JWT for missing user_id=${user.id}. Client likely has stale auth or queued outbox state.`
      );
      return yield* Effect.fail(new InvalidCredentialsError());
    }

    yield* Effect.logInfo(`[Sync:${scope}] Token subject exists in user table. user_id=${persistedUser.id}`);
    return persistedUser;
  });
}
