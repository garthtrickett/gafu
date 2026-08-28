import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { effectPlugin } from "../middleware/effect-plugin.ts";
import { generateJapaneseSentence } from "../../features/ai/ai.service.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";

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
  );
