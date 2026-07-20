import {
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Effect } from "effect";
import { config } from "../Config.ts";
import { s3Client } from "../s3.ts";
import {
  TtsAssetStorageError,
  type TtsAssetStorage,
} from "./TtsAssetService.ts";

type TtsS3Command = HeadObjectCommand | PutObjectCommand;

export interface S3TtsAssetStorageOptions {
  readonly bucketName?: string;
  readonly publicBaseUrl?: string;
  readonly send?: (
    command: TtsS3Command,
  ) => Promise<unknown>;
}

const errorRecord = (
  cause: unknown,
): Readonly<Record<string, unknown>> | null =>
  typeof cause === "object" && cause !== null
    ? (cause as Readonly<Record<string, unknown>>)
    : null;

const isMissingObject = (cause: unknown): boolean => {
  const record = errorRecord(cause);
  if (record === null) return false;

  const name =
    typeof record.name === "string" ? record.name : "";
  const code =
    typeof record.code === "string" ? record.code : "";
  const metadata = errorRecord(record.$metadata);
  const httpStatusCode =
    metadata !== null &&
    typeof metadata.httpStatusCode === "number"
      ? metadata.httpStatusCode
      : undefined;

  return (
    name === "NotFound" ||
    name === "NoSuchKey" ||
    code === "NotFound" ||
    code === "NoSuchKey" ||
    httpStatusCode === 404
  );
};

const normalizePublicBaseUrl = (
  value: string,
): string | null => {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!URL.canParse(trimmed)) {
    return null;
  }

  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    return null;
  }

  if (parsed.search || parsed.hash) {
    return null;
  }

  return trimmed;
};

const contentTypeFromHeadResponse = (
  response: unknown,
): string | null => {
  const record = errorRecord(response);
  if (
    record === null ||
    typeof record.ContentType !== "string"
  ) {
    return null;
  }

  return record.ContentType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? null;
};

export const makeS3TtsAssetStorage = (
  options: S3TtsAssetStorageOptions = {},
): TtsAssetStorage => {
  const bucketName =
    options.bucketName ?? config.s3.bucketName;
  const publicBaseUrl = normalizePublicBaseUrl(
    options.publicBaseUrl ?? config.s3.publicTtsUrl,
  );
  const send =
    options.send ??
    ((command: TtsS3Command) =>
      command instanceof HeadObjectCommand
        ? s3Client.send(command)
        : s3Client.send(command));

  const invalidBaseUrl = (
    operation: "find" | "put",
  ): TtsAssetStorageError =>
    new TtsAssetStorageError({
      operation,
      message:
        "PUBLIC_TTS_BASE_URL must be an absolute HTTP or HTTPS URL without a query string or fragment.",
    });

  const assetUrl = (assetKey: string): string =>
    `${publicBaseUrl}/${assetKey}`;

  return {
    find: (assetKey) =>
      Effect.gen(function* () {
        if (publicBaseUrl === null) {
          return yield* Effect.fail(
            invalidBaseUrl("find"),
          );
        }

        const result = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              send(
                new HeadObjectCommand({
                  Bucket: bucketName,
                  Key: assetKey,
                }),
              ),
            catch: (cause) =>
              new TtsAssetStorageError({
                operation: "find",
                message:
                  "Failed to inspect the persisted TTS asset.",
                cause,
              }),
          }),
        );

        if (result._tag === "Left") {
          if (isMissingObject(result.left.cause)) {
            yield* Effect.logInfo(
              "[S3TtsAssetStorage] object_missing",
              {
                event: "tts_storage_cache_miss",
                assetKey,
                bucketName,
              },
            );
            return null;
          }

          yield* Effect.logError(
            "[S3TtsAssetStorage] head_failure",
            {
              event: "tts_storage_failure",
              operation: "find",
              assetKey,
              bucketName,
            },
          );
          return yield* Effect.fail(result.left);
        }

        const contentType =
          contentTypeFromHeadResponse(result.right);
        if (
          contentType !== null &&
          contentType !== "audio/mpeg"
        ) {
          yield* Effect.logError(
            "[S3TtsAssetStorage] invalid_content_type",
            {
              event: "tts_storage_invalid_content_type",
              assetKey,
              contentType,
            },
          );
          return yield* Effect.fail(
            new TtsAssetStorageError({
              operation: "find",
              message:
                "The persisted TTS asset does not have the required audio/mpeg content type.",
            }),
          );
        }

        yield* Effect.logInfo(
          "[S3TtsAssetStorage] object_found",
          {
            event: "tts_storage_cache_hit",
            assetKey,
            bucketName,
            contentType: contentType ?? "unknown",
          },
        );
        return assetUrl(assetKey);
      }),

    put: (input) =>
      Effect.gen(function* () {
        if (publicBaseUrl === null) {
          return yield* Effect.fail(
            invalidBaseUrl("put"),
          );
        }

        const result = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              send(
                new PutObjectCommand({
                  Bucket: bucketName,
                  Key: input.assetKey,
                  Body: input.audio,
                  ContentType: input.contentType,
                  ContentDisposition: "inline",
                  ContentLength: input.audio.byteLength,
                  CacheControl:
                    "public, max-age=31536000, immutable",
                }),
              ),
            catch: (cause) =>
              new TtsAssetStorageError({
                operation: "put",
                message:
                  "Failed to persist the TTS asset in object storage.",
                cause,
              }),
          }),
        );

        if (result._tag === "Left") {
          yield* Effect.logError(
            "[S3TtsAssetStorage] put_failure",
            {
              event: "tts_storage_failure",
              operation: "put",
              assetKey: input.assetKey,
              bucketName,
            },
          );
          return yield* Effect.fail(result.left);
        }

        yield* Effect.logInfo(
          "[S3TtsAssetStorage] put_success",
          {
            event: "tts_storage_success",
            operation: "put",
            assetKey: input.assetKey,
            bucketName,
            contentType: input.contentType,
            audioBytes: input.audio.byteLength,
          },
        );

        return assetUrl(input.assetKey);
      }),
  };
};
