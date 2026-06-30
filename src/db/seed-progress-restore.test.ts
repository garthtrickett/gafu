import { describe, expect, it } from "vitest";
import { partitionProgressRestoreCatalog } from "./seed-progress-restore";
import type { GrammarPointId } from "../types";

describe("progress restore seed partitioning", () => {
  it("should partition a 296-card catalog into 270 mastered rows, 25 learning rows, and 1 untouched row", () => {
    const catalog = Array.from({ length: 296 }, (_, index) => ({
      id: crypto.randomUUID() as GrammarPointId,
      formal_name: `grammar-${index + 1}`,
      sequence_order: index + 1,
    }));

    const result = partitionProgressRestoreCatalog(catalog);

    expect(result.mastered).toHaveLength(270);
    expect(result.learning).toHaveLength(25);
    expect(result.ignoredAfterLearningWindow).toHaveLength(1);
    expect(result.mastered[0].sequence_order).toBe(1);
    expect(result.mastered[269].sequence_order).toBe(270);
    expect(result.learning[0].sequence_order).toBe(271);
    expect(result.learning[24].sequence_order).toBe(295);
    expect(result.ignoredAfterLearningWindow[0].sequence_order).toBe(296);
  });
});
