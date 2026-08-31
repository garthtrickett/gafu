import { describe, expect, it } from "vitest";
import {
  candidateOwnsSchedule,
  learnerProgressIsDue,
  normalizeKnowledgePointCanonicalKey,
  quarantineTargetForWrongAnalysis,
  transitionLearnerProgress,
} from "./adaptive-media.ts";

describe("adaptive media lifecycle contracts", () => {
  it("normalizes bare AI keys while rejecting a conflicting kind prefix", () => {
    expect(normalizeKnowledgePointCanonicalKey("vocabulary", " もったいない ")).toBe("vocabulary:もったいない");
    expect(normalizeKnowledgePointCanonicalKey("grammar", "grammar:〜ておく")).toBe("grammar:〜ておく");
    expect(normalizeKnowledgePointCanonicalKey("vocabulary", "grammar:〜ておく")).toBeNull();
    expect(normalizeKnowledgePointCanonicalKey("grammar", "grammar:")).toBeNull();
  });

  it("moves a learner through the explicit primer and encounter lifecycle", () => {
    const introduced = transitionLearnerProgress(null, "primer_started");
    expect(introduced).toMatchObject({ _tag: "TransitionAccepted", nextState: "introduced" });

    const primed = transitionLearnerProgress("introduced", "primer_retrieval_completed");
    expect(primed).toMatchObject({ _tag: "TransitionAccepted", nextState: "primed" });

    const encountered = transitionLearnerProgress("primed", "cue_reached");
    expect(encountered).toMatchObject({ _tag: "TransitionAccepted", nextState: "encountered" });

    const learning = transitionLearnerProgress("encountered", "checkout_recalled");
    expect(learning).toMatchObject({ _tag: "TransitionAccepted", nextState: "learning" });

    const stable = transitionLearnerProgress("learning", "varied_mastery_reached");
    expect(stable).toMatchObject({ _tag: "TransitionAccepted", nextState: "stable" });
  });

  it("does not allow passive encounter to establish stability", () => {
    expect(transitionLearnerProgress("encountered", "varied_mastery_reached")).toMatchObject({
      _tag: "TransitionRejected",
    });
    expect(transitionLearnerProgress("encountered", "cue_reached")).toMatchObject({
      _tag: "TransitionAccepted",
      nextState: "encountered",
    });
  });

  it("keeps candidate disposition separate from scheduling", () => {
    expect(candidateOwnsSchedule("pending")).toBe(false);
    expect(candidateOwnsSchedule("accepted")).toBe(false);
    expect(candidateOwnsSchedule("already_known")).toBe(false);
  });

  it("never globally quarantines a curated point from one wrong-analysis report", () => {
    expect(quarantineTargetForWrongAnalysis("curated", true)).toBe("analysis_evidence");
    expect(quarantineTargetForWrongAnalysis("personal", false)).toBe("analysis_evidence");
    expect(quarantineTargetForWrongAnalysis("personal", true)).toBe("personal_knowledge_point");
  });

  it("keeps self-reported known and archived progress out of the due queue", () => {
    expect(learnerProgressIsDue("active", "known")).toBe(false);
    expect(learnerProgressIsDue("archived", "learning")).toBe(false);
    expect(learnerProgressIsDue("active", "primed")).toBe(true);
  });
});
