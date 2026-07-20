import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { config } from "../../lib/server/Config.ts";
import {
  makeGoogleTtsProvider,
  validateGoogleCredentialsEnvironment,
  validateStaticCardAudioProvider,
} from "../../lib/server/media/GoogleTtsProvider.ts";
import { makeS3TtsAssetStorage } from "../../lib/server/media/S3TtsAssetStorage.ts";
import { enrichSessionAudio } from "../../lib/server/media/SessionAudioEnrichmentService.ts";
import {
  TtsProviderError,
  makeTtsAssetService,
} from "../../lib/server/media/TtsAssetService.ts";
import { makePostgresTtsSynthesisBudget } from "../../lib/server/media/TtsSynthesisBudget.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";

const ttsUsageBudget = makePostgresTtsSynthesisBudget(
  config.tts.dailySynthesisLimit,
);

const ttsAssetService = makeTtsAssetService(
  makeGoogleTtsProvider(undefined, {
    usageBudget: ttsUsageBudget,
    maxTransientRetries:
      config.tts.maxTransientRetries,
    retryBaseDelayMs:
      config.tts.retryBaseDelayMs,
  }),
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

const isAuthorizationFailure = (
  error: unknown,
): boolean =>
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

export const ttsRoutes = new Elysia({
  prefix: "/api/tts",
})
  .use(effectPlugin)
  .post(
    "/enrich-session",
    async ({
      body,
      headers,
      set,
      runEffect,
    }) => {
      const requestId = crypto.randomUUID();

      const enrichmentEffect = Effect.gen(function* () {
        yield* Effect.logInfo(
          "[TtsRoutes] enrichment_request_received",
          {
            event: "tts_enrichment_request",
            requestId,
            itemCount: body.items.length,
          },
        );

        const token = extractBearerToken(
          headers["authorization"],
        );

        if (!token) {
          yield* Effect.logWarning(
            "[TtsRoutes] authorization_missing",
            {
              event: "tts_authorization_missing",
              requestId,
            },
          );
          return yield* Effect.fail(
            new InvalidCredentialsError(),
          );
        }

        const user = yield* validateToken(token);
        yield* Effect.logInfo(
          "[TtsRoutes] enrichment_authorized",
          {
            event: "tts_enrichment_authorized",
            requestId,
            userId: user.id,
          },
        );

        if (
          body.items.length >
          config.tts.maxItemsPerImport
        ) {
          return yield* Effect.fail(
            new TtsProviderError({
              kind: "limit",
              message: `A single audio enrichment import may contain at most ${config.tts.maxItemsPerImport} cards.`,
              retryable: false,
            }),
          );
        }

        yield* validateStaticCardAudioProvider(
          config.tts.staticCardProvider,
        );
        yield* validateGoogleCredentialsEnvironment();

        return yield* enrichSessionAudio(
          body.items,
          ttsAssetService,
          {
            concurrencyLimit:
              config.tts.concurrencyLimit,
          },
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
              "[TtsRoutes] enrichment_authorization_failed",
              {
                event:
                  "tts_enrichment_authorization_failed",
                requestId,
              },
            ),
          );
          return {
            success: false,
            error: "Unauthorized",
            requestId,
          };
        }

        if (error instanceof TtsProviderError) {
          set.status =
            error.kind === "limit" ? 429 : 503;
          await runEffect(
            Effect.logWarning(
              "[TtsRoutes] enrichment_unavailable",
              {
                event: "tts_enrichment_unavailable",
                requestId,
                kind: error.kind,
                retryable:
                  error.retryable === true,
              },
            ),
          );
          return {
            success: false,
            error:
              error.kind === "limit"
                ? "TTS limit reached"
                : "TTS unavailable",
            kind: error.kind,
            message: error.message,
            requestId,
          };
        }

        set.status = 500;
        await runEffect(
          Effect.logError(
            "[TtsRoutes] enrichment_unexpected_failure",
            {
              event:
                "tts_enrichment_unexpected_failure",
              requestId,
            },
          ),
        );
        return {
          success: false,
          error: "Internal Server Error",
          requestId,
        };
      }

      await runEffect(
        Effect.logInfo(
          "[TtsRoutes] enrichment_request_completed",
          {
            event: "tts_enrichment_request_completed",
            requestId,
            requestedCount:
              result.right.requestedCount,
            uniqueSentenceCount:
              result.right.uniqueSentenceCount,
            enrichedCount:
              result.right.enrichedCount,
            failedCount: result.right.failedCount,
          },
        ),
      );

      return {
        success: true,
        data: result.right,
        requestId,
        limits: {
          maxItemsPerImport:
            config.tts.maxItemsPerImport,
          dailySynthesisLimit:
            config.tts.dailySynthesisLimit,
          concurrencyLimit:
            config.tts.concurrencyLimit,
        },
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
            maxItems: 100,
          },
        ),
      }),
    },
  );
