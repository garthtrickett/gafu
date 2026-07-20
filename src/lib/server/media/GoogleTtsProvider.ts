import { stat } from "node:fs/promises";
import { Effect } from "effect";
import {
  synthesizeGoogleTtsAudio,
  type GoogleTtsProbeClient,
} from "../tts/GoogleTtsProbe.ts";
import {
  TtsProviderError,
  type TtsAudioProvider,
} from "./TtsAssetService.ts";

export const validateGoogleCredentialsEnvironment =
  (): Effect.Effect<void, TtsProviderError> =>
    Effect.gen(function* () {
      const credentialsPath =
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

      if (!credentialsPath) {
        yield* Effect.logInfo(
          "[GoogleTtsProvider] No explicit credential file configured; Application Default Credentials discovery will be used.",
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
          }),
        );
      }

      yield* Effect.logInfo(
        "[GoogleTtsProvider] Explicit server-side credential file is readable.",
      );
    });

export const makeGoogleTtsProvider = (
  client?: GoogleTtsProbeClient,
): TtsAudioProvider => ({
  synthesize: (input) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        synthesizeGoogleTtsAudio(
          input.text,
          {
            languageCode: input.settings.languageCode,
            voiceName: input.settings.voiceName,
            audioEncoding: input.settings.audioEncoding,
            speakingRate: input.settings.speakingRate,
          },
          client,
        ),
      );

      if (result._tag === "Left") {
        return yield* Effect.fail(
          new TtsProviderError({
            kind: result.left.kind,
            message: result.left.message,
          }),
        );
      }

      return result.right;
    }),
});