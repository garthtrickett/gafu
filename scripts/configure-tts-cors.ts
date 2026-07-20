import "dotenv/config";
import {
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Data, Effect } from "effect";

class TtsCorsConfigurationError extends Data.TaggedError(
  "TtsCorsConfigurationError",
)<{
  readonly message: string;
}> {}

const requiredEnvironment = (
  key: string,
): Effect.Effect<string, TtsCorsConfigurationError> =>
  Effect.gen(function* () {
    const value = process.env[key]?.trim();
    if (!value) {
      return yield* Effect.fail(
        new TtsCorsConfigurationError({
          message: `Missing required environment variable: ${key}.`,
        }),
      );
    }

    return value;
  });

const program = Effect.gen(function* () {
  const bucketName = yield* requiredEnvironment(
    "BUCKET_NAME",
  );
  const endpoint =
    process.env.AWS_ENDPOINT_URL_S3?.trim();
  const region =
    process.env.AWS_REGION?.trim() || "us-east-1";
  const origins = (
    process.env.TTS_CORS_ALLOWED_ORIGINS ??
    "http://localhost:3005,http://127.0.0.1:3005"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return yield* Effect.fail(
      new TtsCorsConfigurationError({
        message:
          "TTS_CORS_ALLOWED_ORIGINS must contain at least one origin.",
      }),
    );
  }

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle:
      process.env.AWS_FORCE_PATH_STYLE === "true" ||
      Boolean(endpoint),
    credentials:
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId:
              process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey:
              process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  yield* Effect.logInfo(
    "[TtsCorsSetup] applying_bucket_cors",
    {
      event: "tts_cors_configuration_started",
      bucketName,
      originCount: origins.length,
    },
  );

  yield* Effect.tryPromise({
    try: () =>
      client.send(
        new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: origins,
                AllowedMethods: ["GET", "HEAD"],
                AllowedHeaders: ["*"],
                ExposeHeaders: [
                  "ETag",
                  "Content-Type",
                  "Cache-Control",
                ],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      ),
    catch: () =>
      new TtsCorsConfigurationError({
        message:
          "Failed to configure CORS on the TTS object-storage bucket.",
      }),
  });

  yield* Effect.logInfo(
    "[TtsCorsSetup] bucket_cors_applied",
    {
      event: "tts_cors_configuration_completed",
      bucketName,
      origins,
    },
  );
});

Effect.runPromise(Effect.either(program)).then(
  (result) => {
    if (result._tag === "Left") {
      process.stderr.write(
        `[TtsCorsSetup] ${result.left.message}\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      "[TtsCorsSetup] CORS configuration applied successfully.\n",
    );
  },
  () => {
    process.stderr.write(
      "[TtsCorsSetup] CORS configuration failed unexpectedly.\n",
    );
    process.exitCode = 1;
  },
);
