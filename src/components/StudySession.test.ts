import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "./StudySession";
import { StudySession, calculateSrsUpdate } from "./StudySession";
import { runClientPromise } from "../lib/client/runtime";
import { grammarPointStore } from "../lib/client/stores/grammarPointStore";
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
    element = document.createElement("study-session") as StudySession;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
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

    it("should reset explanationVisible to false when SUBMIT_GRADE is proposed", async () => {
    const controller = (element as any).controller;
    controller.propose({ type: "TOGGLE_EXPLANATION" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(true);

    controller.propose({ type: "SUBMIT_GRADE", grammarPointId: "gp-123", isCorrect: true });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should reset explanationVisible to false when FORCE_MASTER is proposed", async () => {
    const controller = (element as any).controller;
    controller.propose({ type: "TOGGLE_EXPLANATION" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(true);

        controller.propose({ type: "FORCE_MASTER", grammarPointId: "gp-123" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(controller.model.explanationVisible).toBe(false);
  });

  it("should write a valid HLC string to grammarPointStore on SUBMIT_GRADE", async () => {
    const controller = (element as any).controller;
    
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(hlcStore.clear());
    await runClientPromise(hlcStore.load());

    controller.propose({ type: "SUBMIT_GRADE", grammarPointId: "gp-hlc-test", isCorrect: true });
    
    await new Promise((resolve) => setTimeout(resolve, 30));

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

    controller.propose({ type: "FORCE_MASTER", grammarPointId: "gp-hlc-test-force" });
    
    await new Promise((resolve) => setTimeout(resolve, 30));

    const progress = grammarPointStore.state.peek().find((p) => p.id === "gp-hlc-test-force");
    expect(progress).toBeDefined();
    expect(progress!.hlc).toBeDefined();
    expect(typeof progress!.hlc).toBe("string");
  });
});
