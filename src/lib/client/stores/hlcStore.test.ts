import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { hlcStore, hlcSignal } from "./hlcStore";
import { unpackHlc } from "../../shared/hlc";

describe("hlcStore - Client-Side State and Persistence", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());
  });

  it("should incrementally tick the counter when physical time remains unchanged", async () => {
    const mockTime = 1600000000000;
    vi.spyOn(Date, "now").mockReturnValue(mockTime);

    // Initial load sets wall clock to mockTime
    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());

    const initialPacked = hlcStore.getPacked();
    const initial = unpackHlc(initialPacked);
    expect(initial.physical).toBe(mockTime);
    expect(initial.counter).toBe(0);

    // First tick at the same millisecond
    const firstPacked = await Effect.runPromise(hlcStore.tick());
    const first = unpackHlc(firstPacked);
    expect(first.physical).toBe(mockTime);
    expect(first.counter).toBe(1);

    // Second tick at the same millisecond
    const secondPacked = await Effect.runPromise(hlcStore.tick());
    const second = unpackHlc(secondPacked);
    expect(second.physical).toBe(mockTime);
    expect(second.counter).toBe(2);
  });

  it("should reset counter to 0 when physical time advances", async () => {
    const mockTime1 = 1600000000000;
    vi.spyOn(Date, "now").mockReturnValue(mockTime1);

    await Effect.runPromise(hlcStore.clear());
    await Effect.runPromise(hlcStore.load());
    await Effect.runPromise(hlcStore.tick()); // counter -> 1

    // Advance physical time by 1000ms
    vi.spyOn(Date, "now").mockReturnValue(mockTime1 + 1000);

    const packed = await Effect.runPromise(hlcStore.tick());
    const unpacked = unpackHlc(packed);
    expect(unpacked.physical).toBe(mockTime1 + 1000);
    expect(unpacked.counter).toBe(0);
  });
});
