import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_MEDIA_AUDIO_REPAIR_VERSION,
  LOCAL_MEDIA_HELPER_HEADER,
  LOCAL_MEDIA_HELPER_VERSION,
  isLocalMediaHelperEnabled,
  isLoopbackHostname,
  isLoopbackOrigin,
  isLoopbackPeerAddress,
  makeLocalMediaRoutes,
  requestBodyLimitBytes,
} from "./local-media.ts";
import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES,
} from "../../lib/shared/local-media-helper.ts";

describe("loopback local-media route", () => {
  it("accepts a guarded localhost stream and returns its speech envelope", async () => {
    const analyze = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Float64Array.of(0.1, 0.7, 0.2)));
    const routes = makeLocalMediaRoutes(analyze);
    const response = await routes.handle(new Request("http://127.0.0.1/api/local-media/audio-envelope", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_HELPER_VERSION,
      },
      body: Uint8Array.of(1, 2, 3),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      version: LOCAL_MEDIA_HELPER_VERSION,
      envelope: [0.1, 0.7, 0.2],
    });
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]?.[0]).toBeInstanceOf(ReadableStream);
  });

  it("returns repaired Opus audio only through the guarded loopback route", async () => {
    const analyze = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Float64Array.of(0.1)));
    const repair = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Uint8Array.of(79, 103, 103, 83)));
    const routes = makeLocalMediaRoutes(analyze, repair);
    const response = await routes.handle(new Request("http://localhost/api/local-media/repair-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_AUDIO_REPAIR_VERSION,
      },
      body: Uint8Array.of(1, 2, 3),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/ogg");
    expect(response.headers.get("X-Gafu-Audio-Repair")).toBe(LOCAL_MEDIA_AUDIO_REPAIR_VERSION);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([79, 103, 103, 83]);
    expect(repair).toHaveBeenCalledOnce();
  });

  it("rejects an audio repair request using the analysis protocol version", async () => {
    const analyze = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Float64Array.of(0.1)));
    const repair = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Uint8Array.of(79, 103, 103, 83)));
    const routes = makeLocalMediaRoutes(analyze, repair);
    const response = await routes.handle(new Request("http://localhost/api/local-media/repair-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_HELPER_VERSION,
      },
      body: Uint8Array.of(1, 2, 3),
    }));

    expect(response.status).toBe(403);
    expect(repair).not.toHaveBeenCalled();
  });

  it("rejects media bytes from non-loopback hosts before analysis", async () => {
    const analyze = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Float64Array.of(0.1)));
    const routes = makeLocalMediaRoutes(analyze);
    const response = await routes.handle(new Request("https://life-io.xyz/api/local-media/audio-envelope", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_HELPER_VERSION,
      },
      body: Uint8Array.of(1, 2, 3),
    }));

    expect(response.status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects a hosted browser origin even when it targets localhost", async () => {
    const analyze = vi.fn((_mediaStream: ReadableStream<Uint8Array> | null, _abortSignal: AbortSignal) =>
      Effect.succeed(Float64Array.of(0.1)));
    const routes = makeLocalMediaRoutes(analyze);
    const response = await routes.handle(new Request("http://127.0.0.1/api/local-media/audio-envelope", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Origin": "https://life-io.xyz",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_HELPER_VERSION,
      },
      body: Uint8Array.of(1, 2, 3),
    }));

    expect(response.status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("recognizes only explicit loopback browser hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("app.localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("life-io.xyz")).toBe(false);
    expect(isLoopbackHostname("localhost.life-io.xyz")).toBe(false);
    expect(isLoopbackOrigin("http://localhost:3005")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:3005")).toBe(true);
    expect(isLoopbackOrigin("https://life-io.xyz")).toBe(false);
    expect(isLoopbackPeerAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackPeerAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackPeerAddress("192.168.1.20")).toBe(false);
  });

  it("keeps the helper disabled in production unless a local operator opts in", () => {
    expect(isLocalMediaHelperEnabled("production", undefined)).toBe(false);
    expect(isLocalMediaHelperEnabled("production", "false")).toBe(false);
    expect(isLocalMediaHelperEnabled("production", "true")).toBe(true);
    expect(isLocalMediaHelperEnabled("development", undefined)).toBe(true);
  });

  it("raises Bun's streaming request limit only when the local helper is enabled", () => {
    expect(requestBodyLimitBytes("development", undefined)).toBe(LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES);
    expect(requestBodyLimitBytes("production", "true")).toBe(LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES);
    expect(requestBodyLimitBytes("production", undefined)).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
  });
});
