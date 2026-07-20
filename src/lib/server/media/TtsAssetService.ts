import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Data, Effect } from "effect";

export type TtsAudioEncoding = "MP3";

export interface TtsSynthesisSettings {
  readonly languageCode: string;
  readonly voiceName: string;
  readonly speakingRate: number;
  readonly audioEncoding: TtsAudioEncoding;
  readonly synthesisVersion: number;
}

export interface TtsSynthesisInput {
  readonly text: string;
  readonly settings?: TtsSynthesisSettings;
}

export interface TtsProviderInput {
  readonly text: string;
  readonly settings: TtsSynthesisSettings;
}

export interface TtsAssetWriteInput {
  readonly assetKey: string;
  readonly audio: Buffer;
  readonly contentType: "audio/mpeg";
}

export interface TtsAudioProvider {
  readonly synthesize: (
    input: TtsProviderInput,
  ) => Effect.Effect<Buffer, TtsProviderError>;
}

export interface TtsAssetStorage {
  readonly find: (
    assetKey: string,
  ) => Effect.Effect<string | null, TtsAssetStorageError>;
  readonly put: (
    input: TtsAssetWriteInput,
  ) => Effect.Effect<string, TtsAssetStorageError>;
}

export interface TtsResolvedAsset {
  readonly assetKey: string;
  readonly url: string;
  readonly normalizedText: string;
  readonly settings: TtsSynthesisSettings;
  readonly cacheStatus: "hit" | "miss";
}

export interface TtsAssetService {
  readonly resolve: (
    input: TtsSynthesisInput,
  ) => Effect.Effect<
    TtsResolvedAsset,
    TtsInputError | TtsProviderError | TtsAssetStorageError
  >;
}

export class TtsInputError extends Data.TaggedError("TtsInputError")<{
  readonly message: string;
}> {}

export class TtsProviderError extends Data.TaggedError(
  "TtsProviderError",
)<{
  readonly kind:
    | "configuration"
    | "authentication"
    | "provider"
    | "audio"
    | "limit";
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}> {}

export class TtsAssetStorageError extends Data.TaggedError(
  "TtsAssetStorageError",
)<{
  readonly operation: "find" | "put";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const DEFAULT_JAPANESE_TTS_SETTINGS: TtsSynthesisSettings = {
  languageCode: "ja-JP",
  voiceName: "ja-JP-Neural2-B",
  speakingRate: 0.95,
  audioEncoding: "MP3",
  synthesisVersion: 1,
};

export const MAX_TTS_INPUT_BYTES = 5_000;

export const normalizeTtsText = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/gu, " ").trim();

const sanitizePathSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-");

export const buildTtsAssetKey = (
  normalizedText: string,
  settings: TtsSynthesisSettings,
): string => {
  const identity = JSON.stringify({
    normalizedText,
    languageCode: settings.languageCode,
    voiceName: settings.voiceName,
    speakingRate: settings.speakingRate,
    audioEncoding: settings.audioEncoding,
    synthesisVersion: settings.synthesisVersion,
  });
  const digest = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex");

  return [
    "tts",
    sanitizePathSegment(settings.languageCode),
    sanitizePathSegment(settings.voiceName),
    `v${settings.synthesisVersion}`,
    settings.audioEncoding.toLowerCase(),
    `${digest}.mp3`,
  ].join("/");
};

const validateInput = (
  input: TtsSynthesisInput,
): Effect.Effect<
  {
    readonly normalizedText: string;
    readonly settings: TtsSynthesisSettings;
    readonly assetKey: string;
  },
  TtsInputError
> =>
  Effect.gen(function* () {
    const normalizedText = normalizeTtsText(input.text);
    const settings =
      input.settings ?? DEFAULT_JAPANESE_TTS_SETTINGS;

    if (normalizedText.length === 0) {
      return yield* Effect.fail(
        new TtsInputError({
          message: "TTS text must not be empty.",
        }),
      );
    }

    if (
      Buffer.byteLength(normalizedText, "utf8") >
      MAX_TTS_INPUT_BYTES
    ) {
      return yield* Effect.fail(
        new TtsInputError({
          message: `TTS text must be ${MAX_TTS_INPUT_BYTES} UTF-8 bytes or fewer.`,
        }),
      );
    }

    if (
      settings.languageCode.trim().length === 0 ||
      settings.voiceName.trim().length === 0
    ) {
      return yield* Effect.fail(
        new TtsInputError({
          message:
            "TTS languageCode and voiceName must not be empty.",
        }),
      );
    }

    if (
      !Number.isFinite(settings.speakingRate) ||
      settings.speakingRate < 0.25 ||
      settings.speakingRate > 2
    ) {
      return yield* Effect.fail(
        new TtsInputError({
          message:
            "TTS speakingRate must be between 0.25 and 2.",
        }),
      );
    }

    if (
      !Number.isInteger(settings.synthesisVersion) ||
      settings.synthesisVersion < 1
    ) {
      return yield* Effect.fail(
        new TtsInputError({
          message:
            "TTS synthesisVersion must be a positive integer.",
        }),
      );
    }

    const normalizedSettings: TtsSynthesisSettings = {
      ...settings,
      languageCode: settings.languageCode.trim(),
      voiceName: settings.voiceName.trim(),
    };

    return {
      normalizedText,
      settings: normalizedSettings,
      assetKey: buildTtsAssetKey(
        normalizedText,
        normalizedSettings,
      ),
    };
  });

export const makeTtsAssetService = (
  provider: TtsAudioProvider,
  storage: TtsAssetStorage,
): TtsAssetService => ({
  resolve: (input) =>
    Effect.gen(function* () {
      const validated = yield* validateInput(input);

      const lookupResult = yield* Effect.either(
        storage.find(validated.assetKey),
      );

      if (lookupResult._tag === "Left") {
        yield* Effect.logError(
          "[TtsAssetService] storage_find_failure",
          {
            event: "tts_storage_failure",
            operation: "find",
            assetKey: validated.assetKey,
          },
        );
        return yield* Effect.fail(lookupResult.left);
      }

      if (lookupResult.right !== null) {
        yield* Effect.logInfo(
          "[TtsAssetService] cache_hit",
          {
            event: "tts_cache_hit",
            assetKey: validated.assetKey,
          },
        );

        return {
          assetKey: validated.assetKey,
          url: lookupResult.right,
          normalizedText: validated.normalizedText,
          settings: validated.settings,
          cacheStatus: "hit" as const,
        };
      }

      yield* Effect.logInfo(
        "[TtsAssetService] cache_miss",
        {
          event: "tts_cache_miss",
          assetKey: validated.assetKey,
        },
      );

      const synthesisResult = yield* Effect.either(
        provider.synthesize({
          text: validated.normalizedText,
          settings: validated.settings,
        }),
      );

      if (synthesisResult._tag === "Left") {
        yield* Effect.logError(
          "[TtsAssetService] provider_failure",
          {
            event: "tts_provider_failure",
            assetKey: validated.assetKey,
            kind: synthesisResult.left.kind,
            retryable:
              synthesisResult.left.retryable === true,
          },
        );
        return yield* Effect.fail(synthesisResult.left);
      }

      yield* Effect.logInfo(
        "[TtsAssetService] synthesis_success",
        {
          event: "tts_synthesis_success",
          assetKey: validated.assetKey,
          audioBytes: synthesisResult.right.byteLength,
          voiceName: validated.settings.voiceName,
        },
      );

      const storageResult = yield* Effect.either(
        storage.put({
          assetKey: validated.assetKey,
          audio: synthesisResult.right,
          contentType: "audio/mpeg",
        }),
      );

      if (storageResult._tag === "Left") {
        yield* Effect.logError(
          "[TtsAssetService] storage_put_failure",
          {
            event: "tts_storage_failure",
            operation: "put",
            assetKey: validated.assetKey,
          },
        );
        return yield* Effect.fail(storageResult.left);
      }

      yield* Effect.logInfo(
        "[TtsAssetService] storage_success",
        {
          event: "tts_storage_success",
          assetKey: validated.assetKey,
          contentType: "audio/mpeg",
          audioBytes: synthesisResult.right.byteLength,
        },
      );

      return {
        assetKey: validated.assetKey,
        url: storageResult.right,
        normalizedText: validated.normalizedText,
        settings: validated.settings,
        cacheStatus: "miss" as const,
      };
    }),
});
