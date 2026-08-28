import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenState } from "../lib/client/stores/authStore.ts";
import { parseSrt } from "../lib/client/media/adaptive/subtitles.ts";
import { fallbackTokens } from "../lib/client/media/adaptive/tokenizer.ts";
import "./WatchView.ts";

describe("WatchView local media boundary", () => {
  afterEach(() => {
    tokenState.value = null;
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

  it("records a marker encounter without pausing, seeking, or sending source text", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => "blob:watch-video") },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    const sourceText = "合成された秘密の字幕";
    const cue = { ...parseSrt(`1\n00:00:01,000 --> 00:00:02,000\n${sourceText}`, "track-marker")[0]!, tokens: fallbackTokens(sourceText) };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    tokenState.value = "test-token";
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      loadVideo: (file: File) => void;
      cues: readonly typeof cue[];
      acceptedTargets: readonly unknown[];
      updateCues: () => void;
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.loadVideo(new File(["local"], "local.mp4", { type: "video/mp4" }));
    view.cues = [cue];
    view.acceptedTargets = [{
      candidateId: crypto.randomUUID(), knowledgePointId: crypto.randomUUID(), canonicalKey: "vocabulary:秘密",
      cueIds: [cue.id], subtitleTrackFingerprint: "track-marker", primed: true,
    }];
    await view.updateComplete;
    const video = view.querySelector("video")!;
    video.currentTime = 1.5;
    const beforeTime = video.currentTime;
    view.updateCues();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(video.currentTime).toBe(beforeTime);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    const eventCall = fetchSpy.mock.calls.find(([url]) => url === "/api/adaptive-media/learning/event");
    expect(eventCall).toBeDefined();
    expect(String((eventCall?.[1] as RequestInit).body)).not.toContain(sourceText);
  });
});
