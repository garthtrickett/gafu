import { Data, Effect } from "effect";

export class AudioRepairUnavailable extends Data.TaggedError("AudioRepairUnavailable")<{
  readonly reason: "gpl_core_not_approved" | "browser_codec_unavailable";
}> {}

export interface AudioRepairProgress {
  readonly progress: number;
  readonly message: string;
}

export interface AudioRepairAdapter {
  readonly repair: (file: File, onProgress: (progress: AudioRepairProgress) => void) => Effect.Effect<Blob, AudioRepairUnavailable>;
}

// The jp-player FFmpeg core is GPL-2.0-or-later. Gafu keeps the adapter seam
// and original-audio fallback, but does not ship that payload without the
// explicit legal/product gate recorded in the migration inventory.
export const unavailableAudioRepairAdapter: AudioRepairAdapter = {
  repair: () => Effect.fail(new AudioRepairUnavailable({ reason: "gpl_core_not_approved" })),
};
