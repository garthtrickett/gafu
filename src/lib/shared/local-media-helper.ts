export const LOCAL_MEDIA_HELPER_HEADER = "X-Gafu-Local-Media";
export const LOCAL_MEDIA_HELPER_VERSION = "audio-envelope-v1";
export const LOCAL_MEDIA_AUDIO_REPAIR_VERSION = "audio-repair-v1";
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 128 * 1024 * 1024;
export const LOCAL_MEDIA_REQUEST_BODY_LIMIT_BYTES = 64 * 1024 * 1024 * 1024;

export const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "127.0.0.1" ||
  hostname === "0.0.0.0" ||
  hostname === "::1" ||
  hostname === "[::1]";
