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
import { makeS3TtsAssetStorage } from "./S3TtsAssetStorage.ts";

describe("S3TtsAssetStorage", () => {
  it("returns the deterministic public URL when the object exists", async () => {
    const send = vi.fn(
      (
        _command:
          | HeadObjectCommand
          | PutObjectCommand,
      ) => Promise.resolve({}),
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
          $metadata: { httpStatusCode: 404 },
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

  it("writes immutable MP3 content at the supplied key", async () => {
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
        CacheControl:
          "public, max-age=31536000, immutable",
      });
      expect(command.input.Body).toBe(audio);
    }
  });
});