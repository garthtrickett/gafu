import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { makeGoogleTtsProvider, validateGoogleCredentialsEnvironment } from "../../lib/server/media/GoogleTtsProvider.ts";
import { makeS3TtsAssetStorage } from "../../lib/server/media/S3TtsAssetStorage.ts";
import { enrichSessionAudio } from "../../lib/server/media/SessionAudioEnrichmentService.ts";
import {
  TtsProviderError,
  makeTtsAssetService,
} from "../../lib/server/media/TtsAssetService.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";

const ttsAssetService = makeTtsAssetService(
  makeGoogleTtsProvider(),
  makeS3TtsAssetStorage(),
);

const extractBearerToken = (
  authorizationHeader: string | undefined,
): string | null => {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice(7).trim();
  return token.length > 0 ? token : null;
};

const isAuthorizationFailure = (error: unknown): boolean =>
  error instanceof InvalidCredentialsError ||
  (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (
      error._tag === "Unauthorized" ||
      error._tag === "Forbidden" ||
      error._tag === "AuthError"
    )
  );

export const ttsRoutes = new Elysia({ prefix: "/api/tts" })
  .use(effectPlugin)
  .post(
    "/enrich-session",
    async ({ body, headers, set, runEffect }) => {
      const enrichmentEffect = Effect.gen(function* () {
        yield* Effect.logInfo(
          `[TtsRoutes] Received session enrichment batch with ${body.items.length} items.`,
        );

        const token = extractBearerToken(
          headers["authorization"],
        );

        if (!token) {
          yield* Effect.logWarning(
            "[TtsRoutes] Rejected audio enrichment request without a bearer token.",
          );
          return yield* Effect.fail(
            new InvalidCredentialsError(),
          );
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(
          `[TtsRoutes] Authorized session audio enrichment for userId=${user.id}.`,
        );

        yield* validateGoogleCredentialsEnvironment();

        return yield* enrichSessionAudio(
          body.items,
          ttsAssetService,
        );
      });

      const result = await runEffect(
        Effect.either(enrichmentEffect),
      );

      if (result._tag === "Left") {
        const error = result.left;

        if (isAuthorizationFailure(error)) {
          set.status = 401;
          await runEffect(
            Effect.logWarning(
              "[TtsRoutes] Session enrichment authorization failed.",
            ),
          );
          return {
            success: false,
            error: "Unauthorized",
          };
        }

        if (error instanceof TtsProviderError) {
          set.status = 503;
          await runEffect(
            Effect.logWarning(
              `[TtsRoutes] Google TTS unavailable before batch execution. kind=${error.kind}`,
            ),
          );
          return {
            success: false,
            error: "TTS unavailable",
            kind: error.kind,
            message: error.message,
          };
        }

        set.status = 500;
        await runEffect(
          Effect.logError(
            "[TtsRoutes] Unexpected session enrichment failure.",
          ),
        );
        return {
          success: false,
          error: "Internal Server Error",
        };
      }

      return {
        success: true,
        data: result.right,
      };
    },
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            requestId: t.String({
              minLength: 1,
              maxLength: 100,
            }),
            japaneseSentence: t.String({
              minLength: 1,
              maxLength: 5_000,
            }),
          }),
          {
            minItems: 1,
            maxItems: 20,
          },
        ),
      }),
    },
  );
