import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenState } from "../lib/client/stores/authStore.ts";
import { parseSrt } from "../lib/client/media/adaptive/subtitles.ts";
import { fallbackTokens } from "../lib/client/media/adaptive/tokenizer.ts";
import "./WatchView.ts";

const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");

describe("WatchView local media boundary", () => {
  afterEach(() => {
    tokenState.value = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    if (requestFullscreenDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", requestFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
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

  it("renders readable compact subtitles and fullscreens the complete video stage", async () => {
    const fullscreen = vi.fn(function (this: HTMLElement) { return Promise.resolve(); });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: fullscreen,
    });
    const token = fallbackTokens("年")[0]!;
    const cue = {
      ...parseSrt("1\n00:00:01,000 --> 00:00:02,000\n年末には", "subtitle-display")[0]!,
      tokens: ["年", "末", "に", "は"].map((surface, index) => ({
        ...token,
        surface,
        lemma: surface,
        reading: index === 0 ? "ねん" : "",
        span: { ...token.span, start: index, end: index + 1 },
      })),
    };
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      activeCues: readonly typeof cue[];
      furigana: boolean;
      spacing: number;
      videoUrl: string;
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.furigana = true;
    view.spacing = 0;
    view.videoUrl = "blob:test-video";
    view.activeCues = [cue];
    await view.updateComplete;

    const overlay = view.querySelector("[data-subtitle-overlay]") as HTMLElement;
    expect(overlay.style.fontSize).toBe("clamp(36px,7.5cqw,180px)");
    expect(Array.from(view.querySelectorAll("[data-subtitle-surface]")).map((surface) => surface.textContent).join(""))
      .toBe("年末には");
    expect(view.querySelector("[data-subtitle-reading]")?.textContent).toBe("ねん");
    expect(view.querySelector("ruby")).toBeNull();
    expect(Array.from(view.querySelectorAll("[data-subtitle-token]")).every((span) =>
      (span as HTMLElement).style.marginRight === "0em")).toBe(true);
    expect(Array.from(view.querySelector("[data-subtitle-line]")!.childNodes).filter((node) =>
      node.nodeType === Node.TEXT_NODE && /\s/u.test(node.textContent ?? ""))).toHaveLength(0);

    const sizeInput = Array.from(view.querySelectorAll('input[type="range"]'))
      .find((input) => input.parentElement?.textContent?.includes("Subtitle size")) as HTMLInputElement;
    expect(sizeInput.max).toBe("14");
    sizeInput.value = sizeInput.max;
    sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
    await view.updateComplete;
    expect(overlay.style.fontSize).toBe("clamp(36px,14cqw,180px)");

    (view.querySelector("[data-fullscreen-button]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fullscreen).toHaveBeenCalledOnce());
    expect(fullscreen.mock.contexts[0]).toBe(view.querySelector("[data-video-stage]"));
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

  it("repairs a silent MKV and keeps Firefox-compatible audio synchronized", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    });
    let objectUrlIndex = 0;
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => `blob:watch-media-${++objectUrlIndex}`) },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["opus audio"], { type: "audio/ogg" }),
      { status: 200, headers: { "Content-Type": "audio/ogg" } },
    ));
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      loadVideo: (file: File) => void;
      repairFirefoxAudio: () => void;
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.loadVideo(new File(["local mkv"], "episode.mkv", { type: "video/x-matroska" }));
    await view.updateComplete;

    view.repairFirefoxAudio();
    await vi.waitFor(() => expect(view.textContent).toContain("Audio fixed ✓"));

    const video = view.querySelector("video")!;
    const audio = view.querySelector("audio[data-repaired-audio]") as HTMLAudioElement;
    expect(video.muted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("/api/local-media/repair-audio", expect.objectContaining({
      method: "POST",
      body: expect.any(File),
    }));
    video.currentTime = 12.5;
    audio.currentTime = 3;
    video.dispatchEvent(new Event("seeking"));
    expect(audio.currentTime).toBe(12.5);
    video.dispatchEvent(new Event("play"));
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
  });
});
