import { Effect } from "effect";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "../../db/client.ts";
import type { LearningExerciseContent } from "./ai/schema.ts";
import { acceptMediaCandidate, type RecordMediaCandidateInput } from "./MediaCandidateService.ts";
import {
  recordExerciseReview,
  selectValidatedExercise,
  storeValidatedExercise,
} from "./ExerciseBankService.ts";

const sourceValidation = {
  signatureVersion: "source_signature_v1" as const,
  normalizationVersion: "adaptive_media_nfkc_v1" as const,
  semanticModelVersion: "Xenova/paraphrase-multilingual-MiniLM-L12-v2@transformers-2.17.2" as const,
  decision: "distinct" as const,
};

const setupPoint = async () => {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
  const input: RecordMediaCandidateInput = {
    id: crypto.randomUUID(),
    analysisRunId: crypto.randomUUID(),
    subtitleTrackFingerprint: "e".repeat(64),
    kind: "vocabulary",
    canonicalKey: `vocabulary:試す:${userId}:動詞`,
    reading: "ためす",
    meaning: "to try",
    confidence: 0.95,
    reviewCostClass: "light_vocabulary",
    evidence: [{ cueId: "cue-v1:exercise:srt:0", start: 0, end: 2 }],
    firstEncounterSeconds: 12,
    occurrenceCount: 1,
  };
  const accepted = await Effect.runPromise(acceptMediaCandidate(userId, input, `accept:${input.id}`));
  return { userId, knowledgePointId: accepted.knowledgePointId, canonicalKey: input.canonicalKey };
};

const exercise = (
  canonicalKey: string,
  sentence: string,
  target: string,
  overrides: Partial<LearningExerciseContent["variationProfile"]> = {},
): LearningExerciseContent => {
  const targetStart = sentence.indexOf(target);
  return {
    targetCanonicalKey: canonicalKey,
    context: `A context for ${sentence.length}`,
    japaneseSentence: sentence,
    targetStart,
    targetEnd: targetStart + target.length,
    answer: sentence,
    explanation: "The target expresses trying something.",
    furigana: [{ text: sentence }],
    modality: overrides.questionForm ? "production" : "text_recognition",
    variationTags: ["situation:daily", "register:casual", "polarity:positive"],
    variationProfile: {
      situation: "daily experiment",
      surroundingVocabulary: ["方法"],
      conjugation: "dictionary",
      politeness: "casual",
      register: "spoken",
      speakerIntention: "report",
      polarity: "positive",
      questionForm: false,
      ...overrides,
    },
    qualityChecks: {
      intendedSenseOrFunction: true,
      unambiguousAnswer: true,
      naturalJapanese: true,
      registerMatches: true,
    },
    prerequisiteCanonicalKeys: [],
    confidence: 0.94,
  };
};

describe("adaptive exercise bank", () => {
  it("stores many validated exercises beneath exactly one point schedule and rejects recent/cosmetic copies", async () => {
    const { userId, knowledgePointId, canonicalKey } = await setupPoint();
    const first = exercise(canonicalKey, "今日は新しい方法を試す。", "試す");
    await Effect.runPromise(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId, content: first, sourceValidation,
    }));
    const scheduleCount = await db.selectFrom("srs_card").select("id")
      .where("user_id", "=", userId as never).where("knowledge_point_id", "=", knowledgePointId as never).execute();
    expect(scheduleCount).toHaveLength(1);

    const exact = await Effect.runPromise(Effect.either(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId, content: first, sourceValidation,
    })));
    expect(exact).toMatchObject({ _tag: "Left", left: { code: "recent_duplicate" } });
    const cosmetic = await Effect.runPromise(Effect.either(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId,
      content: exercise(canonicalKey, "今日は古い方法を試す。", "試す"), sourceValidation,
    })));
    expect(cosmetic).toMatchObject({ _tag: "Left", left: { code: "recent_duplicate" } });

    await Effect.runPromise(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId,
      content: exercise(canonicalKey, "旅行先で珍しい料理を試してみますか。", "試して", {
        situation: "travel restaurant",
        surroundingVocabulary: ["旅行先", "料理"],
        conjugation: "te form",
        politeness: "polite",
        register: "service encounter",
        speakerIntention: "invite",
        questionForm: true,
      }),
      sourceValidation,
    }));
    expect(await db.selectFrom("generated_exercise").select("id")
      .where("knowledge_point_id", "=", knowledgePointId as never).execute()).toHaveLength(2);
    expect(await db.selectFrom("srs_card").select("id")
      .where("knowledge_point_id", "=", knowledgePointId as never).execute()).toHaveLength(1);
  });

  it("fails invalid prerequisites closed without storing learner-facing content", async () => {
    const { userId, knowledgePointId, canonicalKey } = await setupPoint();
    const content = {
      ...exercise(canonicalKey, "別の道具を試す。", "試す"),
      prerequisiteCanonicalKeys: ["vocabulary:unknown:missing"],
    };
    const result = await Effect.runPromise(Effect.either(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId, content, sourceValidation,
    })));
    expect(result).toMatchObject({ _tag: "Left", left: { code: "unknown_prerequisite" } });
    expect(await db.selectFrom("generated_exercise").select("id")
      .where("knowledge_point_id", "=", knowledgePointId as never).execute()).toHaveLength(0);
  });

  it("rejects absent/wrong targets, invalid spans and furigana, ambiguous quality, and register mismatch", async () => {
    const { userId, knowledgePointId, canonicalKey } = await setupPoint();
    const valid = exercise(canonicalKey, "家で新しい道具を試す。", "試す");
    const cases: readonly [LearningExerciseContent, string][] = [
      [{ ...valid, targetCanonicalKey: "vocabulary:wrong:sense" }, "invalid_target"],
      [{ ...valid, targetStart: valid.japaneseSentence.length + 1, targetEnd: valid.japaneseSentence.length + 3 }, "invalid_target"],
      [{ ...valid, furigana: [{ text: "一致しない文。" }] }, "invalid_furigana"],
      [{ ...valid, confidence: 0.2 }, "quality_rejected"],
      [{
        ...valid,
        qualityChecks: { ...valid.qualityChecks, unambiguousAnswer: false, registerMatches: false },
      } as unknown as LearningExerciseContent, "quality_rejected"],
    ];
    for (const [content, code] of cases) {
      const result = await Effect.runPromise(Effect.either(storeValidatedExercise(userId, {
        id: crypto.randomUUID(), knowledgePointId, content, sourceValidation,
      })));
      expect(result).toMatchObject({ _tag: "Left", left: { code } });
    }
    expect(await db.selectFrom("generated_exercise").select("id")
      .where("knowledge_point_id", "=", knowledgePointId as never).execute()).toHaveLength(0);
  });

  it("caps long intervals until recall succeeds in two materially different contexts", async () => {
    const { userId, knowledgePointId, canonicalKey } = await setupPoint();
    const first = await Effect.runPromise(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId,
      content: exercise(canonicalKey, "新しい手順を一度試す。", "試す"), sourceValidation,
    }));
    const second = await Effect.runPromise(storeValidatedExercise(userId, {
      id: crypto.randomUUID(), knowledgePointId,
      content: exercise(canonicalKey, "店員に別の靴を試してもいいか尋ねます。", "試して", {
        situation: "shoe shop",
        surroundingVocabulary: ["店員", "靴"],
        conjugation: "te form permission",
        politeness: "polite",
        register: "service encounter",
        speakerIntention: "request permission",
        questionForm: true,
      }),
      sourceValidation,
    }));

    await Effect.runPromise(recordExerciseReview(userId, first.id, true, "review-1", 800, new Date("2026-08-28T10:00:00Z")));
    await Effect.runPromise(recordExerciseReview(userId, first.id, true, "review-2", 700, new Date("2026-08-29T10:00:00Z")));
    const capped = await Effect.runPromise(recordExerciseReview(userId, first.id, true, "review-3", 600, new Date("2026-09-01T10:00:00Z")));
    expect(capped).toMatchObject({ successfulMaterialContextCount: 1, masteryLimited: true, learningState: "learning" });
    expect(capped.metrics.intervalDays).toBe(3);
    expect(capped.metrics.stability).toBe(3);

    const varied = await Effect.runPromise(recordExerciseReview(userId, second.id, true, "review-4", 550, new Date("2026-09-04T10:00:00Z")));
    expect(varied.successfulMaterialContextCount).toBe(2);
    expect(varied.masteryLimited).toBe(false);
    expect(varied.metrics.intervalDays).toBeGreaterThan(3);
    expect(varied.learningState).toBe("stable");
    const progress = await db.selectFrom("srs_card").selectAll()
      .where("knowledge_point_id", "=", knowledgePointId as never).executeTakeFirstOrThrow();
    expect(progress.learning_state).toBe("stable");
    expect(await Effect.runPromise(selectValidatedExercise(userId, knowledgePointId))).toMatchObject({ validatedOnSourceDevice: true });
  });
});
