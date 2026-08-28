import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMediaSession, fingerprintLocalMedia } from "./local-media.ts";

describe("local media ownership and privacy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("revokes replaced and disconnected object URLs", () => {
    const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revoke = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: create },
      revokeObjectURL: { configurable: true, value: revoke },
    });
    const session = new LocalMediaSession();
    session.replace("video", new File(["first"], "first.mkv"));
    session.replace("video", new File(["second"], "second.mp4"));
    session.releaseAll();
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
  });

  it("fingerprints bytes locally without fetch or filename dependence", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const bytes = new TextEncoder().encode("same bytes");
    const file = (name: string) => ({
      name,
      size: bytes.length,
      type: "video/x-matroska",
      slice: () => ({ arrayBuffer: () => Promise.resolve(bytes.buffer) }),
    }) as unknown as File;
    const first = file("private-episode-name.mkv");
    const renamed = file("renamed.mkv");
    expect(await Effect.runPromise(fingerprintLocalMedia(first))).toBe(await Effect.runPromise(fingerprintLocalMedia(renamed)));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
