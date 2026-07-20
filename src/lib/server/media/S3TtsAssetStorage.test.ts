import {
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Buffer } from "node:buffer";
import { Effect } from "effect";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  TtsAssetStorageError,
} from "./TtsAssetService.ts";
import { makeS3TtsAssetStorage } from "./S3TtsAssetStorage.ts";

describe("S3TtsAssetStorage", () => {
  it("returns an absolute deterministic HTTP URL when the MP3 object exists", async () => {
    const send = vi.fn(
      (
        _command:
          | HeadObjectCommand
          | PutObjectCommand,
      ) =>
        Promise.resolve({
          ContentType: "audio/mpeg",
        }),
    );
    const storage = makeS3TtsAssetStorage({
      bucketName: "test-bucket",
      publicBaseUrl: "https://media.test/",
      send,
    });

    const result = await Effect.runPromise(
      storage.find("tts/ja-JP/example.mp3"),
    );

    expect(result).toBe(
      "https://media.test/tts/ja-JP/example.mp3",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(
      HeadObjectCommand,
    );
  });

  it("treats a missing object as a cache miss", async () => {
    const send = vi.fn(
      (
        _command:
          | HeadObjectCommand
          | PutObjectCommand,
      ) =>
        Promise.reject({
          name: "NotFound",
          $metadata: {
            httpStatusCode: 404,
          },
        }),
    );
    const storage = makeS3TtsAssetStorage({
      bucketName: "test-bucket",
      publicBaseUrl: "https://media.test",
      send,
    });

    const result = await Effect.runPromise(
      storage.find("tts/ja-JP/missing.mp3"),
    );

    expect(result).toBeNull();
  });

  it("rejects persisted objects with the wrong content type", async () => {
    const storage = makeS3TtsAssetStorage({
      bucketName: "test-bucket",
      publicBaseUrl: "https://media.test",
      send: vi.fn(() =>
        Promise.resolve({
          ContentType: "application/octet-stream",
        }),
      ),
    });

    const result = await Effect.runPromise(
      Effect.either(
        storage.find("tts/ja-JP/bad.mp3"),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(
        TtsAssetStorageError,
      );
      expect(result.left.message).toContain(
        "audio/mpeg",
      );
    }
  });

  it("rejects non-HTTP public asset bases", async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const storage = makeS3TtsAssetStorage({
      bucketName: "test-bucket",
      publicBaseUrl: "s3://private-bucket",
      send,
    });

    const result = await Effect.runPromise(
      Effect.either(
        storage.find("tts/ja-JP/example.mp3"),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(send).not.toHaveBeenCalled();
  });

  it("writes immutable inline MP3 content at the supplied key", async () => {
    const send = vi.fn(
      (
        _command:
          | HeadObjectCommand
          | PutObjectCommand,
      ) => Promise.resolve({}),
    );
    const storage = makeS3TtsAssetStorage({
      bucketName: "test-bucket",
      publicBaseUrl: "https://media.test",
      send,
    });
    const audio = Buffer.from([
      0x49,
      0x44,
      0x33,
      0x04,
    ]);

    const result = await Effect.runPromise(
      storage.put({
        assetKey: "tts/ja-JP/example.mp3",
        audio,
        contentType: "audio/mpeg",
      }),
    );

    expect(result).toBe(
      "https://media.test/tts/ja-JP/example.mp3",
    );
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (command instanceof PutObjectCommand) {
      expect(command.input).toMatchObject({
        Bucket: "test-bucket",
        Key: "tts/ja-JP/example.mp3",
        ContentType: "audio/mpeg",
        ContentDisposition: "inline",
        CacheControl:
          "public, max-age=31536000, immutable",
      });
      expect(command.input.Body).toBe(audio);
    }
  });
});
