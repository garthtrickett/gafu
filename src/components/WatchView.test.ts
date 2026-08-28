import { afterEach, describe, expect, it, vi } from "vitest";
import "./WatchView.ts";

describe("WatchView local media boundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("creates and revokes a local object URL without calling fetch", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => "blob:watch-video") },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    const revoke = vi.mocked(URL.revokeObjectURL);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      loadVideo: (file: File) => void;
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.loadVideo(new File(["local bytes"], "private.mkv", { type: "video/x-matroska" }));
    await view.updateComplete;
    expect(view.querySelector("video")?.src).toContain("blob:watch-video");
    expect(fetchSpy).not.toHaveBeenCalled();
    view.remove();
    expect(revoke).toHaveBeenCalledWith("blob:watch-video");
  });
});
