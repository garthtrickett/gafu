import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { tokenState } from "../lib/client/stores/authStore.ts";
import { mediaCandidatePreferenceStore } from "../lib/client/stores/mediaCandidatePreferenceStore.ts";
import { knowledgePointStore } from "../lib/client/stores/knowledgePointStore.ts";
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
        reading: ["ねん", "まつ", "に", "は"][index]!,
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
    expect(overlay.style.getPropertyValue("--word-spacing")).toBe("0em");
    expect(Array.from(view.querySelectorAll("[data-subtitle-surface]")).map((surface) => surface.textContent).join(""))
      .toBe("年末には");
    expect(view.querySelector("[data-subtitle-reading]")?.textContent).toBe("ねん");
    expect(view.querySelectorAll("[data-subtitle-reading]")).toHaveLength(2);
    expect(Array.from(view.querySelectorAll("[data-subtitle-token]")).filter((element) =>
      ["に", "は"].includes(element.querySelector("[data-subtitle-surface]")?.textContent ?? ""))
      .every((element) => !element.querySelector("[data-subtitle-reading]"))).toBe(true);
    expect(view.querySelector("ruby")).toBeNull();
    expect(Array.from(view.querySelectorAll("[data-subtitle-token]")).every((span) =>
      (span as HTMLElement).style.marginRight === "var(--word-spacing)")).toBe(true);
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

  it("changes word spacing without rerendering or touching playback clocks", async () => {
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      videoUrl: string;
      repairedAudioUrl: string;
      readonly updateComplete: Promise<boolean>;
      requestUpdate: (name?: PropertyKey, oldValue?: unknown) => void;
    };
    document.body.append(view);
    view.videoUrl = "blob:test-video";
    view.repairedAudioUrl = "blob:test-audio";
    await view.updateComplete;

    const video = view.querySelector("video")!;
    const audio = view.querySelector("audio[data-repaired-audio]") as HTMLAudioElement;
    const overlay = view.querySelector("[data-subtitle-overlay]") as HTMLElement;
    video.currentTime = 18.25;
    audio.currentTime = 18.25;
    const requestUpdate = vi.spyOn(view, "requestUpdate");
    const spacingInput = Array.from(view.querySelectorAll('input[type="range"]'))
      .find((input) => input.parentElement?.textContent?.includes("Word spacing")) as HTMLInputElement;

    spacingInput.value = "0.5";
    spacingInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(requestUpdate).not.toHaveBeenCalled();
    expect(view.querySelector("video")).toBe(video);
    expect(view.querySelector("audio[data-repaired-audio]")).toBe(audio);
    expect(video.currentTime).toBe(18.25);
    expect(audio.currentTime).toBe(18.25);
    expect(overlay.style.getPropertyValue("--word-spacing")).toBe("0.5em");
  });

  it("dismisses a local syllabus target and shows the next ranked option", async () => {
    const item = (candidateId: string, label: string) => ({
      candidateId,
      knowledgePointId: null,
      canonicalKey: `vocabulary:${label}`,
      kind: "vocabulary" as const,
      label,
      meaning: label,
      occurrenceCount: 1,
      confidence: 0.9,
    });
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      syllabus: {
        items: readonly ReturnType<typeof item>[];
        alternates: readonly ReturnType<typeof item>[];
        rejectedCandidateIds: readonly string[];
      };
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.syllabus = {
      items: [item("candidate-one", "one"), item("candidate-two", "two"), item("candidate-three", "three")],
      alternates: [item("candidate-four", "four")],
      rejectedCandidateIds: [],
    };
    await view.updateComplete;

    const dismiss = view.querySelector('button[aria-label="Skip one and show another target"]') as HTMLButtonElement;
    expect(dismiss.textContent).toContain("show next");
    dismiss.click();
    await view.updateComplete;

    expect(Array.from(view.querySelectorAll("strong")).map((element) => element.textContent))
      .toEqual(["two", "three", "four"]);
    expect(view.syllabus.rejectedCandidateIds).toContain("candidate-one");
  });

  it("stores don't-suggest feedback and removes the target from the episode", async () => {
    await Effect.runPromise(mediaCandidatePreferenceStore.clear());
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      syllabus: {
        items: readonly unknown[];
        alternates: readonly unknown[];
        rejectedCandidateIds: readonly string[];
      };
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.syllabus = {
      items: [{
        candidateId: "candidate-cat",
        knowledgePointId: null,
        canonicalKey: "vocabulary:猫:ねこ:名詞",
        kind: "vocabulary",
        label: "猫",
        meaning: "cat",
        occurrenceCount: 4,
        confidence: 0.9,
      }],
      alternates: [],
      rejectedCandidateIds: [],
    };
    await view.updateComplete;

    const suppress = Array.from(view.querySelectorAll("button"))
      .find((button) => button.textContent === "Don't suggest again")!;
    suppress.click();
    await vi.waitFor(() => expect(mediaCandidatePreferenceStore.state.peek()).toEqual([
      expect.objectContaining({ canonicalKey: "vocabulary:猫:ねこ:名詞", disposition: "not_useful" }),
    ]));
    await view.updateComplete;
    expect(Array.from(view.querySelectorAll("strong")).map((element) => element.textContent)).not.toContain("猫");
  });

  it("marks a catalogued syllabus target known in the learner bank", async () => {
    await Effect.runPromise(knowledgePointStore.clear());
    tokenState.value = "test-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      updated: true,
      reason: "marked_known",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const view = document.createElement("watch-view") as unknown as HTMLElement & {
      syllabus: {
        items: readonly unknown[];
        alternates: readonly unknown[];
        rejectedCandidateIds: readonly string[];
      };
      readonly updateComplete: Promise<boolean>;
    };
    document.body.append(view);
    view.syllabus = {
      items: [{
        candidateId: "candidate-grammar",
        knowledgePointId: "knowledge-grammar",
        canonicalKey: "grammar:〜わけではない",
        kind: "grammar",
        label: "〜わけではない",
        meaning: "it is not the case that",
        occurrenceCount: 2,
        confidence: 0.9,
      }],
      alternates: [],
      rejectedCandidateIds: [],
    };
    await view.updateComplete;

    const markKnown = Array.from(view.querySelectorAll("button"))
      .find((button) => button.textContent === "Already know")!;
    markKnown.click();
    await vi.waitFor(() => expect(knowledgePointStore.state.peek()).toEqual([
      expect.objectContaining({ id: "knowledge-grammar", learningState: "known" }),
    ]));
    expect(fetchSpy).toHaveBeenCalledWith("/api/adaptive-media/progress/status", expect.objectContaining({
      method: "POST",
    }));
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
