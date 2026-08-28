import type { NormalizedCue, TimingTransform } from "../../../shared/adaptive-media.ts";
import { findActiveCues } from "./subtitles.ts";

export interface TimeSource {
  readonly currentTime: number;
  readonly duration: number;
}

export class PlaybackClock {
  constructor(
    private readonly video: TimeSource,
    private readonly repairedAudio: TimeSource,
    private useRepairedAudio = false,
  ) {}

  setRepairedAudioActive(active: boolean): void { this.useRepairedAudio = active; }
  currentTime(): number {
    const source = this.useRepairedAudio && Number.isFinite(this.repairedAudio.currentTime) ? this.repairedAudio : this.video;
    return Number.isFinite(source.currentTime) ? source.currentTime : 0;
  }
}

export type CueLifecycleEvent =
  | { readonly type: "cue-enter"; readonly cueId: string; readonly playbackSeconds: number }
  | { readonly type: "cue-exit"; readonly cueId: string; readonly playbackSeconds: number };

export class CueLifecycleTracker {
  private activeIds = new Set<string>();

  update(
    cues: readonly NormalizedCue[],
    playbackSeconds: number,
    transform: TimingTransform,
  ): CueLifecycleEvent[] {
    const nextIds = new Set(findActiveCues(cues, playbackSeconds, transform).map((cue) => cue.id));
    const events: CueLifecycleEvent[] = [];
    for (const cueId of nextIds) {
      if (!this.activeIds.has(cueId)) events.push({ type: "cue-enter", cueId, playbackSeconds });
    }
    for (const cueId of this.activeIds) {
      if (!nextIds.has(cueId)) events.push({ type: "cue-exit", cueId, playbackSeconds });
    }
    this.activeIds = nextIds;
    return events;
  }

  reset(): void { this.activeIds.clear(); }
}
