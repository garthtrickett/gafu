import { Data, Effect } from "effect";
import {
  LOCAL_MEDIA_AUDIO_REPAIR_VERSION,
  LOCAL_MEDIA_HELPER_HEADER,
  isLoopbackHostname,
} from "../../../shared/local-media-helper.ts";
import { clientLog } from "../../clientLog.ts";

export class AudioRepairUnavailable extends Data.TaggedError("AudioRepairUnavailable")<{
  readonly reason: "gpl_core_not_approved" | "browser_codec_unavailable" | "local_helper_unavailable";
  readonly message: string;
}> {}

export interface AudioRepairProgress {
  readonly progress: number;
  readonly message: string;
}

export interface AudioRepairAdapter {
  readonly repair: (file: File, onProgress: (progress: AudioRepairProgress) => void) => Effect.Effect<Blob, AudioRepairUnavailable>;
}

export type LocalAudioRepairRequest = (file: File) => Effect.Effect<Blob, AudioRepairUnavailable>;

const requestLocalAudioRepair: LocalAudioRepairRequest = (file) => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch("/api/local-media/repair-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        [LOCAL_MEDIA_HELPER_HEADER]: LOCAL_MEDIA_AUDIO_REPAIR_VERSION,
      },
      body: file,
    }),
    catch: (cause) => new AudioRepairUnavailable({
      reason: "local_helper_unavailable",
      message: `Could not reach the local audio repair helper: ${String(cause)}`,
    }),
  });
  if (!response.ok) {
    const payload = yield* Effect.either(Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new AudioRepairUnavailable({
        reason: "local_helper_unavailable",
        message: `Local audio repair returned HTTP ${response.status}.`,
      }),
    }));
    const detail = payload._tag === "Right" && typeof payload.right === "object" && payload.right !== null &&
      "error" in payload.right && typeof payload.right.error === "string"
      ? payload.right.error
      : `Local audio repair returned HTTP ${response.status}.`;
    return yield* Effect.fail(new AudioRepairUnavailable({
      reason: "local_helper_unavailable",
      message: detail,
    }));
  }
  const audio = yield* Effect.tryPromise({
    try: () => response.blob(),
    catch: (cause) => new AudioRepairUnavailable({
      reason: "browser_codec_unavailable",
      message: `Could not read the repaired audio track: ${String(cause)}`,
    }),
  });
  if (audio.size === 0 || !audio.type.startsWith("audio/")) {
    return yield* Effect.fail(new AudioRepairUnavailable({
      reason: "browser_codec_unavailable",
      message: "The local helper returned an invalid repaired audio track.",
    }));
  }
  return audio;
});

export const repairAudioWithLocalHelper = (
  file: File,
  hostname: string,
  request: LocalAudioRepairRequest,
  onProgress: (progress: AudioRepairProgress) => void,
): Effect.Effect<Blob, AudioRepairUnavailable> => Effect.gen(function* () {
  if (!isLoopbackHostname(hostname)) {
    yield* clientLog("warn", "[AudioRepair] Refused to send local media from a non-loopback page.", {
      hostname,
    });
    return yield* Effect.fail(new AudioRepairUnavailable({
      reason: "local_helper_unavailable",
      message: "Firefox audio repair is available only when Gafu is running on this machine.",
    }));
  }
  onProgress({ progress: 0.05, message: "Sending the MKV to this machine's FFmpeg process…" });
  yield* clientLog("info", "[AudioRepair] Starting loopback Firefox audio repair.", {
    byteCount: file.size,
  });
  const repaired = yield* request(file);
  onProgress({ progress: 0.9, message: "Preparing Firefox-compatible audio…" });
  yield* clientLog("info", "[AudioRepair] Loopback Firefox audio repair completed.", {
    repairedByteCount: repaired.size,
  });
  return repaired;
});

export const localAudioRepairAdapter: AudioRepairAdapter = {
  repair: (file, onProgress) => repairAudioWithLocalHelper(
    file,
    window.location.hostname,
    requestLocalAudioRepair,
    onProgress,
  ),
};

// The jp-player FFmpeg core is GPL-2.0-or-later. Gafu keeps the adapter seam
// and original-audio fallback, but does not ship that payload without the
// explicit legal/product gate recorded in the migration inventory.
export const unavailableAudioRepairAdapter: AudioRepairAdapter = {
  repair: () => Effect.fail(new AudioRepairUnavailable({
    reason: "gpl_core_not_approved",
    message: "Browser audio repair is unavailable until the FFmpeg core licence gate is approved.",
  })),
};
