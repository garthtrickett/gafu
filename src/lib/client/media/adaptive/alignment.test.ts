import { describe, expect, it } from "vitest";
import { alignSubtitles, pcm16ToEnvelope } from "./alignment.ts";

describe("local subtitle alignment", () => {
  it("ports global offset and gradual timing drift recovery", () => {
    const expectedOffset = 3.4;
    const expectedScale = 1.001;
    const envelope = Float64Array.from({ length: 5200 }, (_, index) => 0.08 + ((index * 17) % 11) / 500);
    const cues: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < 52; index += 1) {
      const start = 8 + index * 9.2 + (index % 3) * 0.37;
      const end = start + 1.3 + (index % 4) * 0.28;
      cues.push({ start, end });
      for (let frame = Math.floor((start * expectedScale + expectedOffset) * 10); frame < Math.ceil((end * expectedScale + expectedOffset) * 10); frame += 1) {
        if (frame >= 0 && frame < envelope.length) envelope[frame] = 0.82 + (frame % 5) * 0.025;
      }
    }
    const result = alignSubtitles(envelope, cues);
    expect(Math.abs(result.transform.offsetSeconds - expectedOffset)).toBeLessThan(0.35);
    expect(Math.abs(result.transform.scale - expectedScale)).toBeLessThan(0.0015);
    expect(result.confidence).toBeGreaterThanOrEqual(0.32);
  });

  it("turns typed PCM into a normalized ten-hertz envelope without Node Buffer", () => {
    const samples = new Int16Array(600);
    samples.fill(12_000, 250, 450);
    const envelope = pcm16ToEnvelope(samples);
    expect(envelope).toBeInstanceOf(Float64Array);
    expect(envelope).toHaveLength(6);
    expect([...envelope].every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(Math.max(...envelope.slice(2, 5))).toBeGreaterThan(Math.max(envelope[0]!, envelope[5]!));
  });
});
