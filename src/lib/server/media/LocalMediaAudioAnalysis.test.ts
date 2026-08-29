import { describe, expect, it, vi } from "vitest";
import { pumpMediaStream, type MediaInputSink } from "./LocalMediaAudioAnalysis.ts";

const mediaStream = () => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(Uint8Array.of(1, 2));
    controller.enqueue(Uint8Array.of(3, 4, 5));
    controller.enqueue(Uint8Array.of(6));
    controller.close();
  },
});

describe("local FFmpeg media streaming", () => {
  it("applies backpressure and closes temporary storage after the complete upload", async () => {
    const sink: MediaInputSink = {
      write: vi.fn(() => 1),
      flush: vi.fn(() => 1),
      end: vi.fn(() => 1),
    };

    const result = await pumpMediaStream(mediaStream(), sink);

    expect(result).toEqual({ receivedByteCount: 6, writeFailed: false });
    expect(sink.write).toHaveBeenCalledTimes(3);
    expect(sink.flush).toHaveBeenCalledTimes(3);
    expect(sink.end).toHaveBeenCalledOnce();
  });

  it("drains the complete HTTP body after temporary storage fails", async () => {
    const sink: MediaInputSink = {
      write: vi.fn(() => { throw new Error("broken FFmpeg pipe"); }),
      flush: vi.fn(() => 1),
      end: vi.fn(() => 1),
    };

    const result = await pumpMediaStream(mediaStream(), sink);

    expect(result).toEqual({ receivedByteCount: 6, writeFailed: true });
    expect(sink.write).toHaveBeenCalledOnce();
    expect(sink.end).not.toHaveBeenCalled();
  });
});
