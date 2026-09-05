import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "./StudySession";
import { StudySession, calculateSrsUpdate } from "./StudySession";
import { runClientPromise } from "../lib/client/runtime";
import { grammarPointStore } from "../lib/client/stores/grammarPointStore";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore";
import { hlcStore } from "../lib/client/stores/hlcStore";

describe("StudySession SRS calculations", () => {
  beforeEach(() => {
    // Stabilize Math.random() for deterministic tests unless explicitly mocked
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should calculate correct updates on correct reviews", () => {
    const initial = { difficulty: 5.0, stability: 0.0, repetitions: 0 };
    const firstCorrect = calculateSrsUpdate(initial, true);
    expect(firstCorrect.repetitions).toBe(1);
    expect(firstCorrect.intervalDays).toBe(1);
    expect(firstCorrect.difficulty).toBe(4.5);
    expect(firstCorrect.stability).toBe(1.0);

    const secondCorrect = calculateSrsUpdate(firstCorrect, true);
    expect(secondCorrect.repetitions).toBe(2);
    expect(secondCorrect.intervalDays).toBe(3);
    expect(secondCorrect.stability).toBe(2.6);
  });

  it("should drop stability and increase difficulty on incorrect reviews if interval is under mature threshold", () => {
    const state = { difficulty: 5.0, stability: 4.0, repetitions: 2 };
    const result = calculateSrsUpdate(state, false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.difficulty).toBe(6.5);
    expect(result.stability).toBe(0.5);
  });

  it("should soften mature card lapses instead of resetting to 0.5 days", () => {
    const matureState = { difficulty: 5.0, stability: 12.0, repetitions: 3 };
    const result = calculateSrsUpdate(matureState, false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(3);
    expect(result.difficulty).toBe(6.5);
    expect(result.stability).toBe(3.0);
  });

  it("should recover difficulty predictably on consecutive repetitions", () => {
    const stateHighDiff = { difficulty: 8.0, stability: 2.0, repetitions: 1 };
    const result = calculateSrsUpdate(stateHighDiff, true);
    expect(result.difficulty).toBe(7.5);
  });

  it("should apply interval fuzz for intervals greater than or equal to 5", () => {
    const state = { difficulty: 5.0, stability: 6.0, repetitions: 2 };
    
    // Without fuzz (Math.random() is 0.5, so multiplier is 1.0)
    const resultStandard = calculateSrsUpdate(state, true);
    expect(resultStandard.intervalDays).toBe(15);

    // Mock Math.random() to return 0.0 (maximum negative fuzz: -5%)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0);
    const resultNegative = calculateSrsUpdate(state, true);
    expect(resultNegative.intervalDays).toBe(14);
    
    // Mock Math.random() to return 1.0 (maximum positive fuzz: +5%)
    randomSpy.mockReturnValue(1.0);
    const resultPositive = calculateSrsUpdate(state, true);
    expect(resultPositive.intervalDays).toBe(16);
  });
});

describe("StudySession Component State Logic", () => {
  let element: StudySession;

  beforeEach(() => {
    activeSessionStore.clear();
    element = document.createElement("study-session") as StudySession;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    activeSessionStore.clear();
    vi.unstubAllGlobals();
  });

  it("should default explanationVisible to false", () => {
    const controller = (element as any).controller;
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should toggle explanationVisible when TOGGLE_EXPLANATION is proposed", async () => {
    const controller = (element as any).controller;
    controller.propose({ type: "TOGGLE_EXPLANATION" });

    // Allow the async action queue to process
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(true);

    controller.propose({ type: "TOGGLE_EXPLANATION" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should toggle the current-card explanation with the E key", async () => {
    activeSessionStore.loadSession([
      {
        knowledgePointId: "gp-explanation-shortcut",
        englishContext: "An explanation recall prompt.",
        japaneseSentence: "日本語です。",
        furigana: [
          { kanji: "日本語", kana: "にほんご" },
          { kanji: "です。" },
        ],
        audioUrl: null,
        explanation: "A concise grammar explanation.",
      },
    ]);
    await element.updateComplete;

    expect(
      element.querySelector("[aria-keyshortcuts='E']"),
    ).not.toBeNull();
    expect(
      element.textContent?.includes("A concise grammar explanation."),
    ).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await element.updateComplete;

    expect(
      element.textContent?.includes("A concise grammar explanation."),
    ).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "E",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await element.updateComplete;

    expect(
      element.textContent?.includes("A concise grammar explanation."),
    ).toBe(false);
  });

      it("should submit correct and incorrect grades with C and I keys", async () => {
        activeSessionStore.loadSession([
          {
            knowledgePointId: "gp-grade-shortcut",
            englishContext: "A grading shortcut prompt.",
            japaneseSentence: "日本語です。",
            furigana: [
              { kanji: "日本語", kana: "にほんご" },
              { kanji: "です。" },
            ],
            audioUrl: null,
          },
        ]);
        await element.updateComplete;

        const controller = (element as any).controller;
        const proposeSpy = vi.spyOn(controller, "propose");

        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "c",
            bubbles: true,
          }),
        );

        expect(proposeSpy).toHaveBeenCalledWith({
          type: "SUBMIT_GRADE",
          knowledgePointId: "gp-grade-shortcut",
          isCorrect: true,
        });

        proposeSpy.mockClear();

        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "I",
            bubbles: true,
          }),
        );

        expect(proposeSpy).toHaveBeenCalledWith({
          type: "SUBMIT_GRADE",
          knowledgePointId: "gp-grade-shortcut",
          isCorrect: false,
        });

        expect(
          element.querySelector("[aria-keyshortcuts='C']"),
        ).not.toBeNull();
        expect(
          element.querySelector("[aria-keyshortcuts='I']"),
        ).not.toBeNull();
      });

      it("should reset explanationVisible to false when SUBMIT_GRADE is proposed", async () => {
    const controller = (element as any).controller;
    controller.propose({ type: "TOGGLE_EXPLANATION" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(true);

    controller.propose({ type: "SUBMIT_GRADE", knowledgePointId: "gp-123", isCorrect: true });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should reset explanationVisible to false when FORCE_MASTER is proposed", async () => {
    const controller = (element as any).controller;
    controller.propose({ type: "TOGGLE_EXPLANATION" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(true);

        controller.propose({ type: "FORCE_MASTER", knowledgePointId: "gp-123" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should hide Japanese by default and toggle it with the J key", async () => {
    activeSessionStore.loadSession([
      {
        knowledgePointId: "gp-japanese-shortcut",
        englishContext: "A recall prompt.",
        japaneseSentence: "日本語です。",
        furigana: [
          { kanji: "日本語", kana: "にほんご" },
          { kanji: "です。" },
        ],
        audioUrl: null,
      },
    ]);
    await element.updateComplete;

    expect(element.querySelector("#japanese-sentence")).toBeNull();
    expect(
      element.querySelector("#japanese-sentence-hidden"),
    ).not.toBeNull();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await element.updateComplete;

    expect(
      element.querySelector("#japanese-sentence"),
    ).not.toBeNull();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "J",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await element.updateComplete;

    expect(element.querySelector("#japanese-sentence")).toBeNull();
  });

  it("should replay current-card audio with the R key", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();

    class MockAudio {
      readonly src: string;

      constructor(src: string) {
        this.src = src;
      }

      play = play;
      pause = pause;
    }

    vi.stubGlobal("Audio", MockAudio);
    activeSessionStore.loadSession([
      {
        knowledgePointId: "gp-audio-shortcut",
        englishContext: "An audio recall prompt.",
        japaneseSentence: "聞いてください。",
        furigana: [
          { kanji: "聞", kana: "き" },
          { kanji: "いてください。" },
        ],
        audioUrl: "https://media.example.test/card.mp3",
      },
    ]);
    await element.updateComplete;

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "r",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("should ignore J shortcuts while typing in an input", async () => {
    activeSessionStore.loadSession([
      {
        knowledgePointId: "gp-input-shortcut",
        englishContext: "A typing safety prompt.",
        japaneseSentence: "日本語です。",
        furigana: [
          { kanji: "日本語", kana: "にほんご" },
          { kanji: "です。" },
        ],
        audioUrl: null,
      },
    ]);
    await element.updateComplete;

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await element.updateComplete;

    expect(element.querySelector("#japanese-sentence")).toBeNull();
    input.remove();
  });

  it("should write a valid HLC string to grammarPointStore on SUBMIT_GRADE", async () => {
    const controller = (element as any).controller;
    
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(hlcStore.clear());
    await runClientPromise(hlcStore.load());

    controller.propose({ type: "SUBMIT_GRADE", knowledgePointId: "gp-hlc-test", isCorrect: true });
    
    // The grade is persisted asynchronously; wait for the record rather than a
    // fixed delay a loaded worker can outrun.
    await vi.waitFor(() => {
      expect(grammarPointStore.state.peek().find((p) => p.id === "gp-hlc-test")).toBeDefined();
    });

    const progress = grammarPointStore.state.peek().find((p) => p.id === "gp-hlc-test");
    expect(progress).toBeDefined();
    expect(progress!.hlc).toBeDefined();
    expect(typeof progress!.hlc).toBe("string");
    expect(progress!.hlc).not.toBe("0000000000000:0000:initial");
  });

  it("should write a valid HLC string to grammarPointStore on FORCE_MASTER", async () => {
    const controller = (element as any).controller;
    
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(hlcStore.clear());
    await runClientPromise(hlcStore.load());

    controller.propose({ type: "FORCE_MASTER", knowledgePointId: "gp-hlc-test-force" });

    await vi.waitFor(() => {
      expect(grammarPointStore.state.peek().find((p) => p.id === "gp-hlc-test-force")).toBeDefined();
    });

    const progress = grammarPointStore.state.peek().find((p) => p.id === "gp-hlc-test-force");
    expect(progress).toBeDefined();
    expect(progress!.hlc).toBeDefined();
    expect(typeof progress!.hlc).toBe("string");
  });
});
