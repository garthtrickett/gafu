import { Effect, HashMap, Logger } from "effect";
import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../../db/client.ts";
import { generatePrimerContent, type LearningContentAgent } from "./LearningContentService.ts";

describe("LearningContentService", () => {
  it("generates a structured primer from target/prerequisites without logging content", async () => {
    const userId = crypto.randomUUID();
    const pointId = crypto.randomUUID();
    await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(db);
    await sql`INSERT INTO knowledge_point (id, kind, canonical_key, scope, owner_user_id, created_from) VALUES (${pointId}::uuid, 'vocabulary', 'vocabulary:試す', 'personal', ${userId}::uuid, 'media')`.execute(db);
    await sql`INSERT INTO vocabulary_point (knowledge_point_id, lemma, reading, part_of_speech, sense_key, meaning) VALUES (${pointId}::uuid, '試す', 'ためす', '動詞', 'test', 'to try')`.execute(db);
    const privateSentence = "週末に新しい方法を試す。";
    const generate = vi.fn<LearningContentAgent["generate"]>(async () => ({ object: {
      form: "試す", reading: "ためす", senseOrFunction: "to try", formation: "object を 試す",
      exampleContext: "Testing a new method on the weekend.", exampleSentence: privateSentence,
      exampleTargetStart: 9, exampleTargetEnd: 11, furigana: [{ text: "試", reading: "ため" }, { text: "す" }],
      retrievalPrompt: "Say ‘to try’.", retrievalAnswer: "試す", listeningMission: "Listen for inflected forms of 試す.",
    } }));
    const logs: string[] = [];
    const logger = Logger.make<unknown, void>((options) => logs.push(JSON.stringify({
      message: options.message, annotations: [...HashMap.toEntries(options.annotations)],
    })));
    const primer = await Effect.runPromise(generatePrimerContent(userId, pointId, { generate }).pipe(
      Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
    ));
    expect(primer.exampleSentence).toBe(privateSentence);
    expect(generate.mock.calls[0]?.[0]).not.toContain(privateSentence);
    expect(logs.join("\n")).not.toContain(privateSentence);
  });
});
