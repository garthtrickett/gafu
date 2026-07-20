import "dotenv/config";
import { Buffer } from "node:buffer";
import { Data, Effect } from "effect";

class TtsAssetVerificationError extends Data.TaggedError(
  "TtsAssetVerificationError",
)<{
  readonly message: string;
}> {}

const requiredEnvironment = (
  key: string,
): Effect.Effect<string, TtsAssetVerificationError> =>
  Effect.gen(function* () {
    const value = process.env[key]?.trim();
    if (!value) {
      return yield* Effect.fail(
        new TtsAssetVerificationError({
          message: `Missing required environment variable: ${key}.`,
        }),
      );
    }

    return value;
  });

const program = Effect.gen(function* () {
  const assetUrl = yield* requiredEnvironment(
    "TTS_ASSET_URL",
  );
  const appOrigin =
    process.env.TTS_APP_ORIGIN?.trim() ||
    "http://localhost:3005";

  if (!URL.canParse(assetUrl)) {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message:
          "TTS_ASSET_URL must be an absolute HTTP or HTTPS URL.",
      }),
    );
  }

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(assetUrl, {
        method: "GET",
        headers: {
          Origin: appOrigin,
        },
      }),
    catch: () =>
      new TtsAssetVerificationError({
        message:
          "The generated TTS asset could not be fetched.",
      }),
  });

  if (!response.ok) {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message: `The generated TTS asset returned HTTP ${response.status}.`,
      }),
    );
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (contentType !== "audio/mpeg") {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message: `Expected Content-Type audio/mpeg but received ${contentType || "no content type"}.`,
      }),
    );
  }

  const allowedOrigin =
    response.headers.get(
      "access-control-allow-origin",
    );
  if (
    allowedOrigin !== "*" &&
    allowedOrigin !== appOrigin
  ) {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message:
          "The object-storage response does not allow the configured application origin.",
      }),
    );
  }

  const cacheControl =
    response.headers.get("cache-control") ?? "";
  if (!/immutable/iu.test(cacheControl)) {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message:
          "The generated TTS asset is missing immutable Cache-Control metadata.",
      }),
    );
  }

  const audio = Buffer.from(
    yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new TtsAssetVerificationError({
          message:
            "The generated TTS response body could not be read.",
        }),
    }),
  );

  const hasId3 =
    audio[0] === 0x49 &&
    audio[1] === 0x44 &&
    audio[2] === 0x33;
  const hasFrameSync =
    audio[0] === 0xff &&
    (((audio[1] ?? 0) & 0xe0) === 0xe0);

  if (!hasId3 && !hasFrameSync) {
    return yield* Effect.fail(
      new TtsAssetVerificationError({
        message:
          "The generated TTS asset does not contain a valid MP3 header.",
      }),
    );
  }

  yield* Effect.logInfo(
    "[TtsAssetVerify] asset_verified",
    {
      event: "tts_asset_verified",
      assetUrl,
      appOrigin,
      contentType,
      cacheControl,
      audioBytes: audio.byteLength,
    },
  );
});

Effect.runPromise(Effect.either(program)).then(
  (result) => {
    if (result._tag === "Left") {
      process.stderr.write(
        `[TtsAssetVerify] ${result.left.message}\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      "[TtsAssetVerify] Asset CORS, metadata, and MP3 content are valid.\n",
    );
  },
  () => {
    process.stderr.write(
      "[TtsAssetVerify] Asset verification failed unexpectedly.\n",
    );
    process.exitCode = 1;
  },
);
