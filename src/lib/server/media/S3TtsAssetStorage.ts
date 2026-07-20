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

export const makeS3TtsAssetStorage = (
  options: S3TtsAssetStorageOptions = {},
): TtsAssetStorage => {
  const bucketName =
    options.bucketName ?? config.s3.bucketName;
  const publicBaseUrl = (
    options.publicBaseUrl ?? config.s3.publicAvatarUrl
  ).replace(/\/+$/u, "");
  const send =
    options.send ??
    ((command: TtsS3Command) =>
      command instanceof HeadObjectCommand
        ? s3Client.send(command)
        : s3Client.send(command));

  const assetUrl = (assetKey: string): string =>
    `${publicBaseUrl}/${assetKey}`;

  return {
    find: (assetKey) =>
      Effect.gen(function* () {
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
            return null;
          }

          return yield* Effect.fail(result.left);
        }

        return assetUrl(assetKey);
      }),

    put: (input) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            send(
              new PutObjectCommand({
                Bucket: bucketName,
                Key: input.assetKey,
                Body: input.audio,
                ContentType: input.contentType,
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
        });

        return assetUrl(input.assetKey);
      }),
  };
};