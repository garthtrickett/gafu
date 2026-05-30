import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { generateExportPayload } from "./sessionSyncStore";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore";

describe("sessionSyncStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should slice the exported queue to a maximum of 40 elements", async () => {
    const mockProgress = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      easeFactor: 2.5,
      repetitions: 0,
      intervalDays: 0,
      nextReview: new Date().toISOString(),
    }));

    const mockCatalog = Array.from({ length: 50 }, (_, i) => ({
      id: `gp-${i}`,
      formal_name: `grammar-${i}`,
      base_meaning: `meaning-${i}`,
      difficulty_level: "N5",
    }));

    vi.spyOn(grammarPointStore, "load").mockReturnValue(Effect.void);
    vi.spyOn(grammarPointCatalogStore, "load").mockReturnValue(Effect.void);
    
    grammarPointStore.state.value = mockProgress;
    grammarPointCatalogStore.state.value = mockCatalog;

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const program = generateExportPayload();
    const resultJson = await Effect.runPromise(program);
    const parsed = JSON.parse(resultJson);

    expect(parsed.queue.length).toBe(40);
    expect(writeTextMock).toHaveBeenCalled();
  });
});
