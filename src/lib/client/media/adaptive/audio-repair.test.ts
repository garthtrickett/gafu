import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  localAudioRepairAdapter,
  repairAudioWithLocalHelper,
  unavailableAudioRepairAdapter,
} from "./audio-repair.ts";

describe("audio repair legal fallback", () => {
  it("does not upload media or load the gated GPL core", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await Effect.runPromise(Effect.either(
      unavailableAudioRepairAdapter.repair(new File(["media"], "episode.mkv"), () => undefined),
    ));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.reason).toBe("gpl_core_not_approved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requests a Firefox-compatible audio track from the loopback helper", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["opus audio"], { type: "audio/ogg" }),
      { status: 200, headers: { "Content-Type": "audio/ogg" } },
    ));
    const progress = vi.fn();
    const file = new File(["media"], "episode.mkv", { type: "video/x-matroska" });

    const repaired = await Effect.runPromise(localAudioRepairAdapter.repair(file, progress));

    expect(repaired.type).toBe("audio/ogg");
    expect(repaired.size).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledWith("/api/local-media/repair-audio", expect.objectContaining({
      method: "POST",
      body: file,
    }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.9 }));
  });

  it("never sends local media to the repair helper from a non-loopback page", async () => {
    const request = vi.fn(() => Effect.succeed(new Blob(["audio"], { type: "audio/ogg" })));
    const result = await Effect.runPromise(Effect.either(repairAudioWithLocalHelper(
      new File(["private"], "episode.mkv"),
      "life-io.xyz",
      request,
      () => undefined,
    )));

    expect(Either.isLeft(result)).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
