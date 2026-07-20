import { stat } from "node:fs/promises";
import { Effect } from "effect";
import { findForbiddenClientCredentialKeys } from "../../shared/clientEnvironmentSafety.ts";
import {
  synthesizeGoogleTtsAudio,
  type GoogleTtsProbeClient,
} from "../tts/GoogleTtsProbe.ts";
import {
  TtsProviderError,
  type TtsAudioProvider,
} from "./TtsAssetService.ts";
import {
  TtsSynthesisBudgetError,
  type TtsSynthesisBudget,
} from "./TtsSynthesisBudget.ts";

export interface GoogleTtsProviderOptions {
  readonly usageBudget?: TtsSynthesisBudget;
  readonly maxTransientRetries?: number;
  readonly retryBaseDelayMs?: number;
}

export const validateStaticCardAudioProvider = (
  providerName: string,
): Effect.Effect<void, TtsProviderError> =>
  Effect.gen(function* () {
    if (providerName.trim().toLowerCase() === "google") {
      yield* Effect.logInfo(
        "[GoogleTtsProvider] static_provider_validated",
        {
          event: "tts_static_provider_validated",
          provider: "google",
        },
      );
      return;
    }

    return yield* Effect.fail(
      new TtsProviderError({
        kind: "configuration",
        message:
          "Static card synthesis is restricted to Google Cloud TTS. Vapi remains disabled for generated card assets.",
        retryable: false,
      }),
    );
  });

export const validateGoogleCredentialsEnvironment =
  (): Effect.Effect<void, TtsProviderError> =>
    Effect.gen(function* () {
      const leakedClientKeys =
        findForbiddenClientCredentialKeys(process.env);

      if (leakedClientKeys.length > 0) {
        yield* Effect.logError(
          "[GoogleTtsProvider] client_credential_leak_detected",
          {
            event: "tts_client_credential_leak",
            keys: leakedClientKeys,
          },
        );
        return yield* Effect.fail(
          new TtsProviderError({
            kind: "configuration",
            message:
              "Google, AWS, TTS, and Vapi credentials must remain server-side and must not use VITE_ environment variables.",
            retryable: false,
          }),
        );
      }

      const credentialsPath =
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

      if (!credentialsPath) {
        yield* Effect.logInfo(
          "[GoogleTtsProvider] adc_discovery_enabled",
          {
            event: "tts_adc_discovery",
            explicitCredentialFile: false,
          },
        );
        return;
      }

      const result = yield* Effect.either(
        Effect.tryPromise({
          try: () => stat(credentialsPath),
          catch: () =>
            new TtsProviderError({
              kind: "authentication",
              message:
                "The configured Google Cloud credential file is missing or unreadable.",
              retryable: false,
            }),
        }),
      );

      if (result._tag === "Left") {
        return yield* Effect.fail(result.left);
      }

      if (!result.right.isFile()) {
        return yield* Effect.fail(
          new TtsProviderError({
            kind: "authentication",
            message:
              "The configured Google Cloud credential location is not a file.",
            retryable: false,
          }),
        );
      }

      yield* Effect.logInfo(
        "[GoogleTtsProvider] credential_file_validated",
        {
          event: "tts_credential_file_validated",
          explicitCredentialFile: true,
        },
      );
    });

const mapBudgetFailure = (
  error: TtsSynthesisBudgetError,
): TtsProviderError =>
  new TtsProviderError({
    kind: error.kind === "limit" ? "limit" : "provider",
    message: error.message,
    retryable: false,
  });

export const makeGoogleTtsProvider = (
  client?: GoogleTtsProbeClient,
  options: GoogleTtsProviderOptions = {},
): TtsAudioProvider => {
  const maxTransientRetries =
    options.maxTransientRetries ?? 2;
  const retryBaseDelayMs =
    options.retryBaseDelayMs ?? 250;

  return {
    synthesize: (input) =>
      Effect.gen(function* () {
        if (options.usageBudget) {
          const reservation = yield* Effect.either(
            options.usageBudget.reserve(),
          );

          if (reservation._tag === "Left") {
            const mapped = mapBudgetFailure(reservation.left);
            yield* Effect.logWarning(
              "[GoogleTtsProvider] budget_rejected",
              {
                event: "tts_budget_rejected",
                kind: mapped.kind,
              },
            );
            return yield* Effect.fail(mapped);
          }

          yield* Effect.logInfo(
            "[GoogleTtsProvider] budget_reserved",
            {
              event: "tts_budget_reserved",
              usageDate: reservation.right.usageDate,
              attemptedCount:
                reservation.right.attemptedCount,
              dailyLimit: reservation.right.dailyLimit,
            },
          );
        }

        let retryIndex = 0;

        while (true) {
          const attemptNumber = retryIndex + 1;
          const result = yield* Effect.either(
            synthesizeGoogleTtsAudio(
              input.text,
              {
                languageCode: input.settings.languageCode,
                voiceName: input.settings.voiceName,
                audioEncoding:
                  input.settings.audioEncoding,
                speakingRate:
                  input.settings.speakingRate,
              },
              client,
            ),
          );

          if (result._tag === "Right") {
            yield* Effect.logInfo(
              "[GoogleTtsProvider] synthesis_success",
              {
                event: "google_tts_synthesis_success",
                attemptNumber,
                audioBytes: result.right.byteLength,
                voiceName: input.settings.voiceName,
              },
            );
            return result.right;
          }

          const retryable =
            result.left.retryable === true;
          const retriesExhausted =
            retryIndex >= maxTransientRetries;

          if (!retryable || retriesExhausted) {
            yield* Effect.logError(
              "[GoogleTtsProvider] synthesis_failure",
              {
                event: "google_tts_synthesis_failure",
                attemptNumber,
                retryable,
                retriesExhausted,
                kind: result.left.kind,
              },
            );
            return yield* Effect.fail(
              new TtsProviderError({
                kind: result.left.kind,
                message: result.left.message,
                retryable,
              }),
            );
          }

          const delayMs =
            retryBaseDelayMs * 2 ** retryIndex;
          retryIndex += 1;

          yield* Effect.logWarning(
            "[GoogleTtsProvider] transient_retry_scheduled",
            {
              event: "google_tts_transient_retry",
              failedAttempt: attemptNumber,
              nextAttempt: retryIndex + 1,
              delayMs,
            },
          );

          if (delayMs > 0) {
            yield* Effect.sleep(`${delayMs} millis`);
          }
        }
      }),
  };
};
