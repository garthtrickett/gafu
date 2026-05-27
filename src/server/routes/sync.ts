import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { db } from "../../db/client.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError, AuthDatabaseError } from "../../features/auth/Errors.ts";
import type { UserId } from "../../types/index.ts";

interface RecordReviewPayload {
  readonly cardId?: string;
  readonly card_id?: string;
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
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          yield* Effect.logError("[Sync:Pull] Unauthorized access: Missing authorization token");
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
            .where("updated_at", ">". sinceDate)
            .execute(),
          catch: (cause) => new AuthDatabaseError({ cause })
        });
        yield* Effect.logInfo(`[Sync:Pull] Retrieved ${srsCards.length} matching SRS reviews from database`);

        const decksResult = decks.map(d => ({
          id: d.id,
          name: d.name,
          category: d.category,
          content: d.content
        }));

        const srsUpdatesResult = srsCards.map(c => ({
          id: c.id,
          easeFactor: c.ease_factor,
          repetitions: c.repetitions,
          nextReview: c.next_review.toISOString(),
          audioUrl: c.audio_url
        }));

        const serverTimestamp = Date.now();
        yield* Effect.logInfo(`[Sync:Pull] Complete. generatedServerTimestamp=${serverTimestamp}`);

        return {
          serverTimestamp,
          decks: decksResult,
          srsUpdates: srsUpdatesResult
        };
      });

      const result = await runEffect(Effect.either(pullEffect));
      if (Effect.isLeft(result)) {
        const error = result.left;
        if (error instanceof InvalidCredentialsError) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
        set.status = 500;
        return { error: "Internal Server Error", message: String(error) };
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
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          yield* Effect.logError("[Sync:Push] Unauthorized access: Missing authorization token");
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(`[Sync:Push] Authorized session for subscriber: ${user.email} (ID: ${user.id})`);

        if (body.type === "record_review") {
          const payload = body.payload as RecordReviewPayload;
          const cardId = payload.cardId ?? payload.card_id;
          const easeFactor = payload.easeFactor ?? payload.ease_factor;
          const repetitions = payload.repetitions;
          const intervalDays = payload.intervalDays ?? payload.interval_days;
          const nextReview = payload.nextReview ?? payload.next_review;

          if (!cardId || !nextReview) {
            yield* Effect.logError("[Sync:Push] Bad request: Card review transaction payload is missing parameters");
            return yield* Effect.fail(new Error("Missing parameters in review payload"));
          }

          yield* Effect.logInfo(`[Sync:Push] Recording review cardId=${cardId}. easeFactor=${easeFactor}, reps=${repetitions}, nextReview=${nextReview}`);

          yield* Effect.tryPromise({
            try: () => db.updateTable("srs_card")
              .set({
                ease_factor: easeFactor,
                repetitions: repetitions,
                interval_days: intervalDays,
                next_review: new Date(nextReview),
                updated_at: new Date()
              })
              .where("id", "=", cardId as any)
              .where("user_id", "=", user.id as UserId)
              .execute(),
            catch: (cause) => new AuthDatabaseError({ cause })
          });
          yield* Effect.logInfo(`[Sync:Push] Review recorded for cardId=${cardId}`);
        } else if (body.type === "toggle_skin") {
          yield* Effect.logInfo(`[Sync:Push] Processing skin toggle. payload=${JSON.stringify(body.payload)}`);
          // Skin toggles do not persist to relational schema; stub logging is processed
        } else if (body.type === "unlock_deck") {
          yield* Effect.logInfo(`[Sync:Push] Processing deck unlock. payload=${JSON.stringify(body.payload)}`);
          // Deck unlock is stubbed since learning decks are initially unlocked on seeding
        } else {
          yield* Effect.logWarning(`[Sync:Push] Unrecognized transaction type: ${body.type}`);
        }

        return { success: true };
      });

      const result = await runEffect(Effect.either(pushEffect));
      if (Effect.isLeft(result)) {
        const error = result.left;
        if (error instanceof InvalidCredentialsError) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
        set.status = 500;
        return { error: "Internal Server Error", message: String(error) };
      }
      return result.right;
    },
    {
      body: t.Object({
        id: t.String(),
        type: t.Union([t.Literal("record_review"), t.Literal("toggle_skin"), t.Literal("unlock_deck")]),
        payload: t.Any(),
        timestamp: t.Number()
      })
    }
  );
