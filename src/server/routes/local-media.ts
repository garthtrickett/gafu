import { Elysia } from "elysia";
import { Effect } from "effect";
import { extractLocalMediaSpeechEnvelope } from "../../lib/server/media/LocalMediaAudioAnalysis.ts";
import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  LOCAL_MEDIA_HELPER_HEADER,
  LOCAL_MEDIA_HELPER_VERSION,
  LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES,
  isLoopbackHostname,
} from "../../lib/shared/local-media-helper.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";

export {
  LOCAL_MEDIA_HELPER_HEADER,
  LOCAL_MEDIA_HELPER_VERSION,
  isLoopbackHostname,
} from "../../lib/shared/local-media-helper.ts";

export const isLocalMediaHelperEnabled = (
  nodeEnvironment = process.env.NODE_ENV,
  explicitSetting = process.env.GAFU_LOCAL_MEDIA_HELPER,
): boolean => nodeEnvironment !== "production" || explicitSetting === "true";

export const requestBodyLimitBytes = (
  nodeEnvironment = process.env.NODE_ENV,
  explicitSetting = process.env.GAFU_LOCAL_MEDIA_HELPER,
): number => isLocalMediaHelperEnabled(nodeEnvironment, explicitSetting)
  ? LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES
  : DEFAULT_REQUEST_BODY_LIMIT_BYTES;

export const isLoopbackOrigin = (origin: string | null): boolean => {
  if (!origin) return true;
  const match = /^https?:\/\/(\[[^\]]+\]|[^:/]+)(?::\d+)?$/u.exec(origin);
  return Boolean(match?.[1] && isLoopbackHostname(match[1]));
};

export const isLoopbackPeerAddress = (address: string): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

export type LocalMediaEnvelopeAnalyzer = (
  mediaStream: ReadableStream<Uint8Array> | null,
  abortSignal: AbortSignal,
) => Effect.Effect<Float64Array, Error>;

export const makeLocalMediaRoutes = (
  analyze: LocalMediaEnvelopeAnalyzer = extractLocalMediaSpeechEnvelope,
) => new Elysia({ prefix: "/api/local-media" })
  .use(effectPlugin)
  .post("/audio-envelope", async ({ request, server, set, runEffect }) => {
    const requestId = crypto.randomUUID();
    const hostname = new URL(request.url).hostname;
    const loopbackOrigin = isLoopbackOrigin(request.headers.get("origin"));
    const peerAddress = server?.requestIP(request)?.address ?? null;
    const loopbackPeer = peerAddress ? isLoopbackPeerAddress(peerAddress) : process.env.NODE_ENV === "test";
    const hasLocalHeader = request.headers.get(LOCAL_MEDIA_HELPER_HEADER) === LOCAL_MEDIA_HELPER_VERSION;
    if (!isLocalMediaHelperEnabled() || !isLoopbackHostname(hostname) || !loopbackOrigin || !loopbackPeer || !hasLocalHeader) {
      set.status = 403;
      await runEffect(Effect.logWarning("[LocalMediaRoutes] Rejected non-loopback media analysis request.", {
        requestId,
        helperEnabled: isLocalMediaHelperEnabled(),
        loopbackHost: isLoopbackHostname(hostname),
        loopbackOrigin,
        loopbackPeer,
        localHeaderPresent: hasLocalHeader,
      }));
      return { success: false, error: "Local media analysis is available only from this machine." };
    }

    await runEffect(Effect.logInfo("[LocalMediaRoutes] Accepted loopback media analysis request.", {
      requestId,
      byteCount: Number(request.headers.get("content-length") ?? 0),
    }));
    const result = await runEffect(Effect.either(analyze(request.body, request.signal)));
    if (result._tag === "Left") {
      set.status = result.left.message.startsWith("Local FFmpeg could not start") ? 503 : 422;
      await runEffect(Effect.logWarning("[LocalMediaRoutes] Local media analysis failed.", {
        requestId,
        reason: result.left.message,
      }));
      return { success: false, error: result.left.message };
    }

    await runEffect(Effect.logInfo("[LocalMediaRoutes] Returning local speech envelope.", {
      requestId,
      frameCount: result.right.length,
    }));
    return {
      success: true,
      version: LOCAL_MEDIA_HELPER_VERSION,
      sampleRateHz: 10,
      envelope: Array.from(result.right),
    };
  }, { parse: "none" });

export const localMediaRoutes = makeLocalMediaRoutes();
