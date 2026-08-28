import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { findActiveCues, fingerprintSubtitleBytes, parseAss, parseAssTime, parseSrt, parseSrtTime } from "./subtitles.ts";

describe("adaptive subtitle parsing", () => {
  it("ports SRT timing, multiline, invalid-record, and stable ordinal behavior", () => {
    const cues = parseSrt(`3\n00:00:04.000 --> 00:00:05.000\n行こう!\n\ninvalid\nnot timing\nignored\n\n1\n00:00:01,250 --> 00:00:03,500\n今日はいい天気。\n本当だね。`, "track-a");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      id: "cue-v1:track-a:srt:2",
      sourceCueOrdinal: 2,
      sourceStartSeconds: 1.25,
      normalizedText: "今日はいい天気。\n本当だね。",
    });
    expect(cues[1]?.id).toBe("cue-v1:track-a:srt:0");
  });

  it("ports ASS tags, line breaks, commas, and source ordinals", () => {
    const cues = parseAss(`[Script Info]\nTitle: demo\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.10,0:00:04.25,Default,,0,0,0,,{\\i1}日本語{\\i0}は、楽しい\\Nですね`, "track-b");
    expect(cues[0]).toMatchObject({
      id: "cue-v1:track-b:ass:0",
      sourceStartSeconds: 2.1,
      sourceEndSeconds: 4.25,
      normalizedText: "日本語は、楽しい\nですね",
    });
  });

  it("keeps cue provenance unchanged after timing alignment", () => {
    const cues = parseSrt(`1\n00:00:01,000 --> 00:00:03,000\n字幕`, "track-c");
    expect(findActiveCues(cues, 4, { id: "alignment", version: "timing_transform_v1", scale: 1, offsetSeconds: 3 }).map((entry) => entry.id))
      .toEqual(["cue-v1:track-c:srt:0"]);
  });

  it("parses timestamp precision and hashes exact subtitle bytes", async () => {
    expect(parseSrtTime("01:02:03,045")).toBe(3723.045);
    expect(parseAssTime("1:02:03.45")).toBe(3723.45);
    const first = await Effect.runPromise(fingerprintSubtitleBytes(new TextEncoder().encode("字幕\n")));
    const second = await Effect.runPromise(fingerprintSubtitleBytes(new TextEncoder().encode("字幕\r\n")));
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });
});
