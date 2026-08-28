import { describe, expect, it } from "vitest";
import { PlaybackClock, CueLifecycleTracker } from "./playback.ts";
import { parseSrt } from "./subtitles.ts";

describe("playback clock and cue events", () => {
  it("makes repaired audio authoritative only while enabled", () => {
    const clock = new PlaybackClock({ currentTime: 2, duration: 10 }, { currentTime: 4, duration: 10 });
    expect(clock.currentTime()).toBe(2);
    clock.setRepairedAudioActive(true);
    expect(clock.currentTime()).toBe(4);
  });

  it("emits typed cue lifecycle events without subtitle text", () => {
    const cues = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nprivate line", "track");
    const tracker = new CueLifecycleTracker();
    const transform = { id: "source", version: "timing_transform_v1" as const, scale: 1, offsetSeconds: 0 };
    expect(tracker.update(cues, 1.5, transform)).toEqual([{ type: "cue-enter", cueId: cues[0]!.id, playbackSeconds: 1.5 }]);
    const exit = tracker.update(cues, 2.5, transform);
    expect(exit).toEqual([{ type: "cue-exit", cueId: cues[0]!.id, playbackSeconds: 2.5 }]);
    expect(JSON.stringify(exit)).not.toContain("private line");
  });
});
