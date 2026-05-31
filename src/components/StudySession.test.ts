import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "./StudySession";
import { StudySession, calculateSrsUpdate } from "./StudySession";

describe("StudySession SRS calculations", () => {
  beforeEach(() => {
    // Stabilize Math.random() for deterministic tests unless explicitly mocked
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should calculate correct updates on correct reviews", () => {
    const initial = { easeFactor: 2.5, repetitions: 0, intervalDays: 0 };
    const firstCorrect = calculateSrsUpdate(initial, true);
    expect(firstCorrect.repetitions).toBe(1);
    expect(firstCorrect.intervalDays).toBe(1);
    expect(firstCorrect.easeFactor).toBeGreaterThan(2.5);

    const secondCorrect = calculateSrsUpdate(firstCorrect, true);
    expect(secondCorrect.repetitions).toBe(2);
    expect(secondCorrect.intervalDays).toBe(6);
  });

  it("should reset to 1 day on incorrect reviews if interval is under mature threshold", () => {
    const state = { easeFactor: 2.8, repetitions: 4, intervalDays: 4 };
    const result = calculateSrsUpdate(state, false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBe(2.6); 
  });

  it("should soften mature card lapses instead of resetting to 1 day", () => {
    const matureState = { easeFactor: 2.5, repetitions: 3, intervalDays: 40 };
    const result = calculateSrsUpdate(matureState, false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(8); // 40 * 0.20 = 8
    expect(result.easeFactor).toBe(2.3); // 2.5 - 0.2
  });

  it("should recover easeFactor more aggressively on consecutive repetitions", () => {
    const stateLowEase = { easeFactor: 1.3, repetitions: 2, intervalDays: 2 };
    // repetitions becomes 3 (consecutive >= 3), so it gets 0.25 bonus
    const result = calculateSrsUpdate(stateLowEase, true);
    expect(result.repetitions).toBe(3);
    expect(result.easeFactor).toBe(1.55); // 1.3 + 0.25
  });

  it("should apply interval fuzz for intervals greater than or equal to 5", () => {
    const state = { easeFactor: 2.5, repetitions: 2, intervalDays: 6 };
    
    // Mock Math.random() to return 0.0 (maximum negative fuzz: -5%)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.0);
    // Next interval: 6 * 2.5 = 15. With max negative fuzz (-5%), 15 * 0.95 = 14.25 -> rounded to 14
    const resultNegative = calculateSrsUpdate(state, true);
    expect(resultNegative.intervalDays).toBe(14);
    
    // Mock Math.random() to return 1.0 (maximum positive fuzz: +5%)
    randomSpy.mockReturnValue(1.0);
    // With max positive fuzz (+5%), 15 * 1.05 = 15.75 -> rounded to 16
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
});
