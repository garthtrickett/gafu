import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  TtsAssetStorageError,
  type TtsAssetStorage,
} from "./TtsAssetService.ts";

export interface FileSystemTtsAssetStorageOptions {
  readonly rootDirectory: string;
}

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause)
  ) {
    return undefined;
  }

  return typeof cause.code === "string"
    ? cause.code
    : undefined;
};

export const makeFileSystemTtsAssetStorage = (
  options: FileSystemTtsAssetStorageOptions,
): TtsAssetStorage => {
  const rootDirectory = resolve(options.rootDirectory);

  const resolveAssetPath = (
    assetKey: string,
    operation: "find" | "put",
  ): Effect.Effect<string, TtsAssetStorageError> =>
    Effect.gen(function* () {
      const assetPath = resolve(rootDirectory, assetKey);
      const isInsideRoot =
        assetPath === rootDirectory ||
        assetPath.startsWith(`${rootDirectory}${sep}`);

      if (!isInsideRoot) {
        return yield* Effect.fail(
          new TtsAssetStorageError({
            operation,
            message:
              "TTS asset key resolved outside the configured storage root.",
          }),
        );
      }

      return assetPath;
    });

  return {
    find: (assetKey) =>
      Effect.gen(function* () {
        const assetPath = yield* resolveAssetPath(
          assetKey,
          "find",
        );
        const result = yield* Effect.either(
          Effect.tryPromise({
            try: () => stat(assetPath),
            catch: (cause) =>
              new TtsAssetStorageError({
                operation: "find",
                message:
                  "Failed to inspect the local TTS asset cache.",
                cause,
              }),
          }),
        );

        if (result._tag === "Left") {
          if (nodeErrorCode(result.left.cause) === "ENOENT") {
            return null;
          }

          return yield* Effect.fail(result.left);
        }

        if (!result.right.isFile()) {
          return null;
        }

        return pathToFileURL(assetPath).href;
      }),

    put: (input) =>
      Effect.gen(function* () {
        const assetPath = yield* resolveAssetPath(
          input.assetKey,
          "put",
        );

        yield* Effect.tryPromise({
          try: () =>
            mkdir(dirname(assetPath), { recursive: true }).then(
              () => writeFile(assetPath, input.audio),
            ),
          catch: (cause) =>
            new TtsAssetStorageError({
              operation: "put",
              message:
                "Failed to persist the local TTS audio asset.",
              cause,
            }),
        });

        return pathToFileURL(assetPath).href;
      }),
  };
};