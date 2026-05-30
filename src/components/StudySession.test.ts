import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./StudySession";
import { StudySession, calculateSrsUpdate } from "./StudySession";

describe("StudySession SRS calculations", () => {
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

  it("should reset properly on incorrect reviews", () => {
    const state = { easeFactor: 2.8, repetitions: 4, intervalDays: 15 };
    const result = calculateSrsUpdate(state, false);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBe(2.6); 
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
});
