import { describe, expect, it } from "vitest";
import { pcm16LittleEndianBytesToEnvelope, pcm16ToEnvelope } from "./adaptive-audio-envelope.ts";

describe("adaptive audio envelopes", () => {
  it("decodes FFmpeg little-endian PCM consistently on every host architecture", () => {
    const samples = Int16Array.from({ length: 300 }, (_, index) =>
      index < 100 ? 0 : index < 200 ? 12_000 : -4_000);
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));

    expect(pcm16LittleEndianBytesToEnvelope(bytes)).toEqual(pcm16ToEnvelope(samples));
  });
});
