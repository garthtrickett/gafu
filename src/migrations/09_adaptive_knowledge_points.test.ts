import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { Database } from "../types/index.ts";
import * as m00 from "./00_init_db.ts";
import * as m01 from "./01_dynamic_grammar_srs.ts";
import * as m02 from "./02_user_preferences.ts";
import * as m03 from "./03_add_hlc_columns.ts";
import * as m04 from "./04_add_enforce_mastery_gates.ts";
import * as m05 from "./05_add_fsrs_lite_columns.ts";
import * as m06 from "./06_backfill_fsrs_lite.ts";
import * as m07 from "./07_add_sync_epoch.ts";
import * as m08 from "./08_add_tts_daily_usage.ts";
import * as migration from "./09_adaptive_knowledge_points.ts";

describe("adaptive knowledge-point migration", () => {
  it("backfills a populated pre-change database without changing review metrics", async () => {
    const baseUrl = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "");
    const databaseName = `adaptive_migration_${process.env.VITEST_WORKER_ID ?? "1"}_${crypto.randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = "/postgres";
    const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    const databaseUrl = new URL(baseUrl);
    databaseUrl.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
    const isolatedDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

    try {
      for (const step of [m00, m01, m02, m03, m04, m05, m06, m07, m08]) await step.up(isolatedDb);
      const userId = crypto.randomUUID();
      const deckId = crypto.randomUUID();
      const pointId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const lastReviewedAt = new Date("2026-08-20T10:00:00.000Z");
      const nextReview = new Date("2026-08-29T10:00:00.000Z");

      await sql`INSERT INTO "user" (id, email, password_hash) VALUES (${userId}::uuid, ${`${userId}@example.test`}, 'hash')`.execute(isolatedDb);
      await sql`INSERT INTO deck (id, name, category, content, hlc) VALUES (${deckId}::uuid, 'Migration fixture', 'test', '{}'::jsonb, '1000000000000:0000:test')`.execute(isolatedDb);
      await sql`
        INSERT INTO grammar_point (
          id, deck_id, formal_name, base_meaning, lesson_number, sequence_order,
          difficulty_level, hlc, created_at, updated_at
        ) VALUES (
          ${pointId}::uuid, ${deckId}::uuid, '〜ながら', 'while doing', 1, 1,
          'N4', '1000000000001:0000:test', '2026-08-01', '2026-08-02'
        )
      `.execute(isolatedDb);
      await sql`
        INSERT INTO srs_card (
          id, user_id, grammar_point_id, ease_factor, repetitions, interval_days,
          next_review, difficulty, stability, last_reviewed_at, hlc, created_at, updated_at
        ) VALUES (
          ${cardId}::uuid, ${userId}::uuid, ${pointId}::uuid, 2.35, 4, 9,
          ${nextReview}, 6.25, 12.5, ${lastReviewedAt}, '1000000000002:0000:test',
          '2026-08-03', '2026-08-21'
        )
      `.execute(isolatedDb);

      await migration.up(isolatedDb);

      const migrated = await isolatedDb.selectFrom("srs_card").selectAll().where("id", "=", cardId as never).executeTakeFirstOrThrow();
      expect(migrated.knowledge_point_id).toBe(pointId);
      expect(migrated.grammar_point_id).toBe(pointId);
      expect({
        ease: migrated.ease_factor,
        repetitions: migrated.repetitions,
        interval: migrated.interval_days,
        nextReview: migrated.next_review.toISOString(),
        difficulty: Number(migrated.difficulty),
        stability: Number(migrated.stability),
        lastReviewedAt: migrated.last_reviewed_at?.toISOString(),
        hlc: migrated.hlc,
      }).toEqual({
        ease: 2.35,
        repetitions: 4,
        interval: 9,
        nextReview: nextReview.toISOString(),
        difficulty: 6.25,
        stability: 12.5,
        lastReviewedAt: lastReviewedAt.toISOString(),
        hlc: "1000000000002:0000:test",
      });
      expect(await isolatedDb.selectFrom("knowledge_point").select("id").where("id", "=", pointId as never).executeTakeFirst())
        .toBeDefined();
    } finally {
      await isolatedDb.destroy();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    }
  });
});
