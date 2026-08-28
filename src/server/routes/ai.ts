import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { generateJapaneseSentence } from "../../features/ai/ai.service.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import {
  DailySessionGenerationError,
  generateDailySession,
} from "../../lib/server/ai/DailySessionGenerationService.ts";

export const aiRoutes = new Elysia({ prefix: "/api/ai" })
  .use(effectPlugin)
  .post(
    "/generate",
    async ({ body, headers, set, runEffect }) => {
      const generateEffect = Effect.gen(function* () {
        yield* Effect.logInfo("[AiRoutes] Received request to generate sentence.");

        // Authenticate the user to protect the AI endpoint
        const authHeader = headers["authorization"];
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

        if (!token || token === "null" || token === "undefined" || token.trim() === "") {
          yield* Effect.logError("[AiRoutes] Unauthorized access: Missing or invalid token.");
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo("[AiRoutes] Authorized request.").pipe(
          Effect.annotateLogs("userId", user.id),
        );

        const prompt = body.prompt;
        const sentence = yield* generateJapaneseSentence(prompt);

        return { success: true, data: sentence };
      });

      const result = await runEffect(Effect.either(generateEffect));

      if (result._tag === "Left") {
        const error = result.left;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await runEffect(Effect.logError("[AiRoutes] Generation failed."));

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
        prompt: t.String({ minLength: 1, error: "Prompt is required." })
      })
    }
  )
  .post(
    "/generate-session",
    async ({ body, headers, set, runEffect }) => {
      const generateEffect = Effect.gen(function* () {
        yield* Effect.logInfo(
          `[AiRoutes] Received daily session generation request for ${body.queue.length} cards.`,
        );

        const authHeader = headers.authorization;
        const token = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;
        if (!token || token.trim().length === 0) {
          yield* Effect.logWarning(
            "[AiRoutes] Daily session generation rejected because authentication was missing.",
          );
          return yield* Effect.fail(new InvalidCredentialsError());
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(
          "[AiRoutes] Daily session generation authorized.",
        ).pipe(Effect.annotateLogs("userId", user.id));

        return yield* generateDailySession(body);
      });

      const result = await runEffect(Effect.either(generateEffect), {
        name: "daily_session_generation",
        attributes: { "session.queue_size": body.queue.length },
      });

      if (result._tag === "Left") {
        const error = result.left;
        const errorTag =
          error && typeof error === "object" && "_tag" in error
            ? (error as { readonly _tag?: string })._tag
            : undefined;
        if (
          error instanceof InvalidCredentialsError ||
          errorTag === "Unauthorized" ||
          errorTag === "Forbidden" ||
          errorTag === "AuthError"
        ) {
          set.status = 401;
          return { error: "Unauthorized" };
        }

        if (error instanceof DailySessionGenerationError) {
          set.status =
            error.code === "invalid_request"
              ? 400
              : error.code === "not_configured"
                ? 503
                : 502;
          await runEffect(
            Effect.logWarning(
              `[AiRoutes] Daily session generation failed with code=${error.code}.`,
            ),
          );
          return {
            error:
              error.code === "not_configured"
                ? "AI generation is not configured. Set OPENAI_API_KEY on the server."
                : error.code === "invalid_request"
                  ? "The session generation request was invalid."
                  : "The AI provider did not return a valid session.",
          };
        }

        set.status = 500;
        return { error: "Internal Server Error" };
      }

      return { success: true as const, data: result.right };
    },
    {
      body: t.Object({
        mode: t.Union([t.Literal("standard"), t.Literal("cram")]),
        queue: t.Array(
          t.Object({
            grammar_point_id: t.String({ minLength: 1, maxLength: 100 }),
            formal_name: t.String({ minLength: 1, maxLength: 200 }),
            repetitions: t.Integer({ minimum: 0 }),
            ease_factor: t.Number({ minimum: 0.01 }),
          }),
          { minItems: 1, maxItems: 15 },
        ),
        vocabulary_pool: t.Array(
          t.String({ minLength: 1, maxLength: 100 }),
          { minItems: 1, maxItems: 2_000 },
        ),
      }),
    },
  );
