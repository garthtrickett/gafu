import { describe, it, expect } from "vitest";
import { calculateSrsUpdate } from "./StudySession";

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