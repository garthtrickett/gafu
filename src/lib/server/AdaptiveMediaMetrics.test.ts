import { Effect, HashMap, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { recordAdaptiveMediaMetric } from "./AdaptiveMediaMetrics.ts";

describe("adaptive media privacy-safe metrics", () => {
  it("logs only the typed identifier/outcome dimensions", async () => {
    const output: string[] = [];
    const logger = Logger.make<unknown, void>((options) => output.push(JSON.stringify({
      message: options.message,
      annotations: [...HashMap.toEntries(options.annotations)],
    })));
    await Effect.runPromise(recordAdaptiveMediaMetric({
      name: "mastery_review",
      knowledgePointId: "point-id",
      recalled: true,
      variedContextCount: 2,
      masteryLimited: false,
    }).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))));
    expect(output.join("\n")).toContain("variedContextCount");
    expect(output.join("\n")).not.toMatch(/japaneseSentence|subtitle|answer|filename/);
  });

  it("rejects undeclared source-bearing dimensions at runtime", async () => {
    const unsafe = { name: "queue_opened", pendingFreshCount: 1, freshOfferedCount: 1, sourceText: "秘密" };
    expect(await Effect.runPromise(Effect.either(recordAdaptiveMediaMetric(unsafe as never)))).toMatchObject({ _tag: "Left" });
  });
});
