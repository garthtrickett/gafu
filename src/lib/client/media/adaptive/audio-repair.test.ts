import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import { unavailableAudioRepairAdapter } from "./audio-repair.ts";

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
});
