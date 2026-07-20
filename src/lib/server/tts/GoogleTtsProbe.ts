import textToSpeech from "@google-cloud/text-to-speech";
import { Buffer } from "node:buffer";
import { Data, Effect } from "effect";

export interface GoogleTtsSynthesisSettings {
  readonly languageCode: string;
  readonly voiceName: string;
  readonly audioEncoding: "MP3";
  readonly speakingRate: number;
}

export const GOOGLE_TTS_PROBE_CONFIG: GoogleTtsSynthesisSettings = {
  languageCode: "ja-JP",
  voiceName: "ja-JP-Neural2-B",
  audioEncoding: "MP3",
  speakingRate: 0.95,
};

export const DEFAULT_GOOGLE_TTS_SMOKE_TEXT =
  "今日は日本語の勉強を続けます。";

export const MAX_GOOGLE_TTS_INPUT_BYTES = 5_000;

type ProbeFailureKind =
  | "configuration"
  | "authentication"
  | "provider"
  | "audio";

type AudioContent = string | Uint8Array | null | undefined;

export interface GoogleTtsProbeRequest {
  readonly input: { readonly text: string };
  readonly voice: {
    readonly languageCode: string;
    readonly name: string;
  };
  readonly audioConfig: {
    readonly audioEncoding: "MP3";
    readonly speakingRate: number;
  };
}

export interface GoogleTtsProbeClient {
  readonly listVoiceNames: (
    languageCode: string,
  ) => Promise<readonly string[]>;
  readonly synthesizeSpeech: (
    request: GoogleTtsProbeRequest,
  ) => Promise<AudioContent>;
}

export class GoogleTtsProbeError extends Data.TaggedError(
  "GoogleTtsProbeError",
)<{
  readonly kind: ProbeFailureKind;
  readonly message: string;
}> {}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "";

const errorCode = (
  cause: unknown,
): string | number | undefined => {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause)
  ) {
    return undefined;
  }

  const code = cause.code;
  return typeof code === "string" ||
    typeof code === "number"
    ? code
    : undefined;
};

const sanitizeGoogleFailure = (
  cause: unknown,
): GoogleTtsProbeError => {
  const message = errorMessage(cause);
  const code = errorCode(cause);
  const credentialFileConfigured = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  );

  if (
    code === 16 ||
    code === "16" ||
    /UNAUTHENTICATED|default credentials|invalid_grant/i.test(
      message,
    ) ||
    (credentialFileConfigured &&
      /ENOENT|does not exist|no such file|not found/i.test(
        message,
      ))
  ) {
    return new GoogleTtsProbeError({
      kind: "authentication",
      message:
        "Google Cloud Application Default Credentials are unavailable. Run 'gcloud auth application-default login' or configure a readable server-side GOOGLE_APPLICATION_CREDENTIALS file.",
    });
  }

  if (
    code === 7 ||
    code === "7" ||
    /PERMISSION_DENIED|SERVICE_DISABLED|API has not been used|billing/i.test(
      message,
    )
  ) {
    return new GoogleTtsProbeError({
      kind: "provider",
      message:
        "Google Cloud Text-to-Speech access was denied. Confirm billing and texttospeech.googleapis.com are enabled for the ADC project.",
    });
  }

  return new GoogleTtsProbeError({
    kind: "provider",
    message: "Google Cloud Text-to-Speech request failed.",
  });
};

const validateText = (
  text: string,
): Effect.Effect<string, GoogleTtsProbeError> =>
  Effect.gen(function* () {
    const normalized = text.trim();

    if (normalized.length === 0) {
      return yield* Effect.fail(
        new GoogleTtsProbeError({
          kind: "configuration",
          message: "Google TTS text must not be empty.",
        }),
      );
    }

    if (
      Buffer.byteLength(normalized, "utf8") >
      MAX_GOOGLE_TTS_INPUT_BYTES
    ) {
      return yield* Effect.fail(
        new GoogleTtsProbeError({
          kind: "configuration",
          message: `Google TTS text must be ${MAX_GOOGLE_TTS_INPUT_BYTES} UTF-8 bytes or fewer.`,
        }),
      );
    }

    return normalized;
  });

const decodeMp3 = (
  content: AudioContent,
): Effect.Effect<Buffer, GoogleTtsProbeError> =>
  Effect.gen(function* () {
    const audio =
      typeof content === "string"
        ? Buffer.from(content, "base64")
        : content instanceof Uint8Array
          ? Buffer.from(content)
          : Buffer.alloc(0);

    const hasId3 =
      audio[0] === 0x49 &&
      audio[1] === 0x44 &&
      audio[2] === 0x33;
    const hasFrameSync =
      audio[0] === 0xff &&
      (((audio[1] ?? 0) & 0xe0) === 0xe0);

    if (!hasId3 && !hasFrameSync) {
      return yield* Effect.fail(
        new GoogleTtsProbeError({
          kind: "audio",
          message:
            "Google Cloud Text-to-Speech returned empty or invalid MP3 audio.",
        }),
      );
    }

    return audio;
  });

export const makeGoogleTtsProbeClient =
  (): GoogleTtsProbeClient => {
    const client =
      new textToSpeech.TextToSpeechClient();

    return {
      listVoiceNames: (languageCode) =>
        client
          .listVoices({ languageCode })
          .then(([response]) =>
            (response.voices ?? []).flatMap((voice) =>
              voice.name ? [voice.name] : [],
            ),
          ),
      synthesizeSpeech: (request) =>
        client
          .synthesizeSpeech({
            input: { text: request.input.text },
            voice: {
              languageCode:
                request.voice.languageCode,
              name: request.voice.name,
            },
            audioConfig: {
              audioEncoding:
                request.audioConfig.audioEncoding,
              speakingRate:
                request.audioConfig.speakingRate,
            },
          })
          .then(([response]) => response.audioContent),
    };
  };

export const synthesizeGoogleTtsAudio = (
  text: string,
  settings: GoogleTtsSynthesisSettings,
  client?: GoogleTtsProbeClient,
): Effect.Effect<Buffer, GoogleTtsProbeError> =>
  Effect.gen(function* () {
    const normalized = yield* validateText(text);
    const probeClient =
      client ?? makeGoogleTtsProbeClient();

    yield* Effect.logInfo(
      `[GoogleTtsProvider] Synthesizing ${settings.audioEncoding} with ${settings.voiceName} at speaking rate ${settings.speakingRate}.`,
    );

    const content = yield* Effect.tryPromise({
      try: () =>
        probeClient.synthesizeSpeech({
          input: { text: normalized },
          voice: {
            languageCode: settings.languageCode,
            name: settings.voiceName,
          },
          audioConfig: {
            audioEncoding: settings.audioEncoding,
            speakingRate: settings.speakingRate,
          },
        }),
      catch: sanitizeGoogleFailure,
    });

    const audio = yield* decodeMp3(content);
    yield* Effect.logInfo(
      `[GoogleTtsProvider] Synthesis completed with ${audio.byteLength} bytes.`,
    );
    return audio;
  });

export const synthesizeGoogleTtsProbe = (
  text: string = DEFAULT_GOOGLE_TTS_SMOKE_TEXT,
  client?: GoogleTtsProbeClient,
): Effect.Effect<Buffer, GoogleTtsProbeError> =>
  Effect.gen(function* () {
    const probeClient =
      client ?? makeGoogleTtsProbeClient();

    yield* Effect.logInfo(
      `[GoogleTtsProbe] Verifying ADC and voice ${GOOGLE_TTS_PROBE_CONFIG.voiceName}.`,
    );

    const voiceNames = yield* Effect.tryPromise({
      try: () =>
        probeClient.listVoiceNames(
          GOOGLE_TTS_PROBE_CONFIG.languageCode,
        ),
      catch: sanitizeGoogleFailure,
    });

    if (
      !voiceNames.includes(
        GOOGLE_TTS_PROBE_CONFIG.voiceName,
      )
    ) {
      return yield* Effect.fail(
        new GoogleTtsProbeError({
          kind: "configuration",
          message: `Google Cloud did not return ${GOOGLE_TTS_PROBE_CONFIG.voiceName} for ${GOOGLE_TTS_PROBE_CONFIG.languageCode}.`,
        }),
      );
    }

    return yield* synthesizeGoogleTtsAudio(
      text,
      GOOGLE_TTS_PROBE_CONFIG,
      probeClient,
    );
  });
