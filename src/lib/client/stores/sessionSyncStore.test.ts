import { Effect } from "effect";
import { describe, it, expect, beforeEach } from "vitest";
import { runClientPromise } from "../runtime.ts";
import { activeSessionStore } from "./activeSessionStore.ts";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore.ts";
import {
  generateExportPayload,
  importSessionPayload,
  type SessionAudioEnricher,
  type SessionAudioEnrichmentRequestItem,
  type ImportSessionProgress,
} from "./sessionSyncStore.ts";

const successfulAudioEnricher: SessionAudioEnricher = {
  enrich: (items) =>
    Effect.succeed({
      items: items.map((item) => ({
        requestId: item.requestId,
        audioUrl: `https://media.example.test/${item.requestId}.mp3`,
      })),
      requestedCount: items.length,
      enrichedCount: items.length,
      failedCount: 0,
    }),
};

describe("sessionSyncStore export payload gating integration tests", () => {
  beforeEach(async () => {
    activeSessionStore.clear();
    await runClientPromise(grammarPointStore.clear());
    await runClientPromise(grammarPointCatalogStore.clear());
  });

  it("should cap massive backlogs of due rules to a maximum of 15 items in the exported queue sorted by retrievability", async () => {
    const catalogItems = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // Seed progress with varying lastReviewedAt dates to create a clear retrievability gradient
    const nowMs = Date.now();
    const progressItems = Array.from({ length: 50 }, (_, i) => {
      // i = 0 was reviewed 50 hours ago (lowest retrievability, highest priority)
      // i = 49 was reviewed 1 hour ago (highest retrievability, lowest priority)
      const hoursAgo = 50 - i;
      const lastReviewedAt = new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();
      return {
        id: `gp-${i}`,
        easeFactor: 2.5,
        repetitions: 1,
        intervalDays: 1,
        difficulty: 5.0,
        stability: 24.0,
        lastReviewedAt,
        nextReview: new Date().toISOString(),
        hlc: "0000000000000:0000:initial"
      };
    });
    await runClientPromise(grammarPointStore.putAll(progressItems));

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(15);
    // gp-0 has been reviewed longest ago, so it has the lowest retrievability and is placed first
    expect(payload.queue[0]?.grammar_point_id).toBe("gp-0");
    expect(payload.queue[14]?.grammar_point_id).toBe("gp-14");
  });

  it("should unlock and append up to 3 new rules for eligible users who meet the 80% mastery gate", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 3, intervalDays: 1, stability: 8.0, difficulty: 4.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 1, stability: 8.0, difficulty: 4.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(5);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual([
      "gp-0",
      "gp-1",
      "gp-2",
      "gp-3",
      "gp-4",
    ]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(5);
    expect(finalProgress[2]?.unlockedAt).toBeDefined();
    expect(finalProgress[3]?.unlockedAt).toBeDefined();
    expect(finalProgress[4]?.unlockedAt).toBeDefined();
  });

    it("should stamp newly unlocked grammar points with a valid ticked HLC during generation", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    // Trigger payload generation to unlock new rules
    await runClientPromise(generateExportPayload());

    const progress = grammarPointStore.state.peek();
    expect(progress.length).toBeGreaterThan(0);
    
    // Verify that every single unlocked progress record is securely stamped with a valid ticked HLC
    for (const record of progress) {
      expect(record.hlc).toBeDefined();
      expect(typeof record.hlc).toBe("string");
      expect(record.hlc).not.toBe("0000000000000:0000:initial");
    }
  });

  it("should stamp newly activated grammar points with a valid ticked HLC during import", async () => {
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11",
          english_context: "Import HLC check context.",
          japanese_sentence: "学生です。",
          explanation: "Copula test."
        }
      ]
    };

    await runClientPromise(
      importSessionPayload(JSON.stringify(mockPayload), {
        audioEnricher: successfulAudioEnricher,
      }),
    );

    const progress = grammarPointStore.state.peek().find(p => p.id === "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11");
    expect(progress).toBeDefined();
    expect(progress!.hlc).toBeDefined();
    expect(typeof progress!.hlc).toBe("string");
    expect(progress!.hlc).not.toBe("0000000000000:0000:initial");
  });

  it("should append 0 new rules for ineligible users who do not meet the 80% mastery gate", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    expect(payload.queue).toHaveLength(2);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual(["gp-0", "gp-1"]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });

  it("should unlock and append up to 3 new rules for ineligible users if enforceMasteryGates is toggled off", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const past = new Date(Date.now() - 100000).toISOString();
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
        { id: "gp-1", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: past, hlc: "0000000000000:0000:initial" },
      ])
    );

    // Disable mastery gate enforcement
    const preferences = await import("./userPreferencesStore.ts");
    await runClientPromise(preferences.userPreferencesStore.updateLimits(20, 3, false));

    const jsonString = await runClientPromise(generateExportPayload());
    const payload = JSON.parse(jsonString);

    // Verify that new rules were introduced despite < 80% mastery
    expect(payload.queue).toHaveLength(5);
    expect(payload.queue.map((q: any) => q.grammar_point_id)).toEqual([
      "gp-0",
      "gp-1",
      "gp-2",
      "gp-3",
      "gp-4",
    ]);

    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(5);
  });

  it("should compile a cram payload containing unmastered active rules regardless of due state, with cram instructions", async () => {
    const catalogItems = Array.from({ length: 5 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
      hlc: "0000000000000:0000:initial"
    }));
    await runClientPromise(grammarPointCatalogStore.putAll(catalogItems));

    const future = new Date(Date.now() + 100000).toISOString(); // future -> not due
    const past = new Date(Date.now() - 100000).toISOString(); // past -> due
    await runClientPromise(
      grammarPointStore.putAll([
        { id: "gp-0", easeFactor: 2.5, repetitions: 0, intervalDays: 0, stability: 0.0, difficulty: 5.0, lastReviewedAt: null, nextReview: future, hlc: "0000000000000:0000:initial" }, // active, unmastered, NOT due
        { id: "gp-1", easeFactor: 2.5, repetitions: 3, intervalDays: 10, stability: 10.0, difficulty: 5.0, lastReviewedAt: past, nextReview: past, hlc: "0000000000000:0000:initial" }, // active, mastered, due
      ])
    );

    // Re-enable gate
    const preferences = await import("./userPreferencesStore.ts");
    await runClientPromise(preferences.userPreferencesStore.updateLimits(20, 3, true));

    const jsonString = await runClientPromise(generateExportPayload({ isCram: true }));
    const payload = JSON.parse(jsonString);

    // The cram payload should contain gp-0 (unmastered, despite being in the future), and NOT gp-1 (mastered)
    expect(payload.queue).toHaveLength(1);
    expect(payload.queue[0]?.grammar_point_id).toBe("gp-0");

    // Verify instructions contain cram-specific terminology
    expect(payload.instructions).toContain("CRAM/REINFORCEMENT");

    // Verify no new rules are unlocked
    const finalProgress = grammarPointStore.state.peek();
    expect(finalProgress).toHaveLength(2);
  });

it("enriches fifteen null-audio cards before loading activeSessionStore", async () => {
  const requestedBatches: SessionAudioEnrichmentRequestItem[][] = [];
  const audioEnricher: SessionAudioEnricher = {
    enrich: (items) =>
      Effect.sync(() => {
        requestedBatches.push([...items]);
        return {
          items: items.map((item) => ({
            requestId: item.requestId,
            audioUrl: `https://media.example.test/${item.requestId}.mp3`,
          })),
          requestedCount: items.length,
          enrichedCount: items.length,
          failedCount: 0,
        };
      }),
  };
  const mockPayload = {
    cards: Array.from({ length: 15 }, (_, index) => ({
      grammar_point_id: `gp-audio-${index}`,
      english_context: `Context ${index}`,
      japanese_sentence: `例文${index}です。`,
      audio_url: null,
    })),
  };

  const result = await runClientPromise(
    importSessionPayload(JSON.stringify(mockPayload), {
      audioEnricher,
    }),
  );

  expect(result).toEqual({
    importedCount: 15,
    audioRequestedCount: 15,
    audioFailedCount: 0,
  });
  expect(requestedBatches).toHaveLength(1);
  expect(requestedBatches[0]).toHaveLength(15);
  expect(activeSessionStore.masterList.value).toHaveLength(15);
  expect(
    activeSessionStore.masterList.value.every(
      (card) =>
        typeof card.audioUrl === "string" &&
        card.audioUrl.startsWith("https://"),
    ),
  ).toBe(true);
  expect(activeSessionStore.audioWarning.value).toBeNull();
});

it("preserves supplied audio URLs and excludes them from enrichment", async () => {
  const requestedBatches: SessionAudioEnrichmentRequestItem[][] = [];
  const audioEnricher: SessionAudioEnricher = {
    enrich: (items) =>
      Effect.sync(() => {
        requestedBatches.push([...items]);
        return {
          items: items.map((item) => ({
            requestId: item.requestId,
            audioUrl: "https://media.example.test/generated.mp3",
          })),
          requestedCount: items.length,
          enrichedCount: items.length,
          failedCount: 0,
        };
      }),
  };
  const existingUrl =
    "https://media.example.test/existing.mp3";
  const mockPayload = {
    cards: [
      {
        grammar_point_id: "gp-existing",
        english_context: "Existing context",
        japanese_sentence: "既存です。",
        audio_url: existingUrl,
      },
      {
        grammar_point_id: "gp-generated",
        english_context: "Generated context",
        japanese_sentence: "生成です。",
        audio_url: null,
      },
    ],
  };

  await runClientPromise(
    importSessionPayload(JSON.stringify(mockPayload), {
      audioEnricher,
    }),
  );

  expect(requestedBatches).toHaveLength(1);
  expect(requestedBatches[0]).toEqual([
    {
      requestId: "card-1",
      japaneseSentence: "生成です。",
    },
  ]);

  const existingCard =
    activeSessionStore.masterList.value.find(
      (card) => card.knowledgePointId === "gp-existing",
    );
  const generatedCard =
    activeSessionStore.masterList.value.find(
      (card) => card.knowledgePointId === "gp-generated",
    );

  expect(existingCard?.audioUrl).toBe(existingUrl);
  expect(generatedCard?.audioUrl).toBe(
    "https://media.example.test/generated.mp3",
  );
});

it("keeps the session usable and records a warning when one synthesis fails", async () => {
  const audioEnricher: SessionAudioEnricher = {
    enrich: (items) =>
      Effect.succeed({
        items: items.map((item, index) =>
          index === 1
            ? {
                requestId: item.requestId,
                audioUrl: null,
                failureKind: "provider" as const,
              }
            : {
                requestId: item.requestId,
                audioUrl: `https://media.example.test/${item.requestId}.mp3`,
              },
        ),
        requestedCount: items.length,
        enrichedCount: items.length - 1,
        failedCount: 1,
      }),
  };
  const mockPayload = {
    cards: [
      {
        grammar_point_id: "gp-success-1",
        english_context: "Context 1",
        japanese_sentence: "成功一です。",
        audio_url: null,
      },
      {
        grammar_point_id: "gp-failure",
        english_context: "Context 2",
        japanese_sentence: "失敗です。",
        audio_url: null,
      },
      {
        grammar_point_id: "gp-success-2",
        english_context: "Context 3",
        japanese_sentence: "成功二です。",
        audio_url: null,
      },
    ],
  };

  const result = await runClientPromise(
    importSessionPayload(JSON.stringify(mockPayload), {
      audioEnricher,
    }),
  );

  expect(result.audioFailedCount).toBe(1);
  expect(activeSessionStore.masterList.value).toHaveLength(3);
  expect(
    activeSessionStore.masterList.value.filter(
      (card) => card.audioUrl === null,
    ),
  ).toHaveLength(1);
  expect(activeSessionStore.audioWarning.value).toEqual({
    missingCount: 1,
    totalCount: 3,
  });
});

it("rejects malformed JSON before invoking audio enrichment", async () => {
  let enrichmentCallCount = 0;
  const audioEnricher: SessionAudioEnricher = {
    enrich: () =>
      Effect.sync(() => {
        enrichmentCallCount += 1;
        return {
          items: [],
          requestedCount: 0,
          enrichedCount: 0,
          failedCount: 0,
        };
      }),
  };

  const result = await runClientPromise(
    Effect.either(
      importSessionPayload("{ malformed json", {
        audioEnricher,
      }),
    ),
  );

  expect(result._tag).toBe("Left");
  expect(enrichmentCallCount).toBe(0);
  expect(activeSessionStore.masterList.value).toEqual([]);
});

it("validates every card before invoking audio enrichment", async () => {
  let enrichmentCallCount = 0;
  const audioEnricher: SessionAudioEnricher = {
    enrich: () =>
      Effect.sync(() => {
        enrichmentCallCount += 1;
        return {
          items: [],
          requestedCount: 0,
          enrichedCount: 0,
          failedCount: 0,
        };
      }),
  };
  const mockPayload = {
    cards: [
      {
        grammar_point_id: "gp-valid",
        english_context: "Valid context",
        japanese_sentence: "有効です。",
        audio_url: null,
      },
      {
        grammar_point_id: "gp-invalid",
        english_context: "Missing sentence",
        audio_url: null,
      },
    ],
  };

  const result = await runClientPromise(
    Effect.either(
      importSessionPayload(JSON.stringify(mockPayload), {
        audioEnricher,
      }),
    ),
  );

  expect(result._tag).toBe("Left");
  expect(enrichmentCallCount).toBe(0);
  expect(activeSessionStore.masterList.value).toEqual([]);
});


it("reports real audio progress from validation through finalization", async () => {
  const progressEvents: ImportSessionProgress[] = [];
  const audioEnricher: SessionAudioEnricher = {
    enrich: (items, onProgress) =>
      Effect.sync(() => {
        onProgress?.({
          completedCount: 1,
          totalCount: items.length,
          succeededCount: 1,
          failedCount: 0,
        });
        onProgress?.({
          completedCount: items.length,
          totalCount: items.length,
          succeededCount: items.length - 1,
          failedCount: 1,
        });

        return {
          items: items.map((item, index) => ({
            requestId: item.requestId,
            audioUrl:
              index === items.length - 1
                ? null
                : `https://media.example.test/${item.requestId}.mp3`,
            ...(index === items.length - 1
              ? { failureKind: "provider" as const }
              : {}),
          })),
          requestedCount: items.length,
          enrichedCount: items.length - 1,
          failedCount: 1,
        };
      }),
  };
  const mockPayload = {
    cards: [
      {
        grammar_point_id: "gp-existing-progress",
        english_context: "Existing audio context",
        japanese_sentence: "既存音声です。",
        audio_url: "https://media.example.test/existing.mp3",
      },
      {
        grammar_point_id: "gp-generated-progress-1",
        english_context: "Generated audio context one",
        japanese_sentence: "生成音声一です。",
        audio_url: null,
      },
      {
        grammar_point_id: "gp-generated-progress-2",
        english_context: "Generated audio context two",
        japanese_sentence: "生成音声二です。",
        audio_url: null,
      },
    ],
  };

  const result = await runClientPromise(
    importSessionPayload(JSON.stringify(mockPayload), {
      audioEnricher,
      onProgress: (progress) => {
        progressEvents.push(progress);
      },
    }),
  );

  expect(result.audioFailedCount).toBe(1);
  expect(progressEvents[0]).toEqual({
    phase: "validating",
    totalCards: 3,
    audioCompletedCount: 0,
    audioSucceededCount: 0,
    audioFailedCount: 0,
  });
  expect(progressEvents).toContainEqual({
    phase: "generating_audio",
    totalCards: 3,
    audioCompletedCount: 2,
    audioSucceededCount: 2,
    audioFailedCount: 0,
  });
  expect(progressEvents.at(-1)).toEqual({
    phase: "finalizing",
    totalCards: 3,
    audioCompletedCount: 3,
    audioSucceededCount: 2,
    audioFailedCount: 1,
  });
});

});
