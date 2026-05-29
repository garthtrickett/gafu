import { Kysely, sql } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<any>) {
  // 1. Create global grammar_point table representing abstract grammar concepts
  await db.schema
    .createTable("grammar_point")
    .ifNotExists()
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("deck_id", "uuid", (c) => c.notNull().references("deck.id").onDelete("cascade"))
    .addColumn("formal_name", "text", (c) => c.notNull())
    .addColumn("base_meaning", "text", (c) => c.notNull())
    .addColumn("lesson_number", "integer", (c) => c.notNull())
    .addColumn("sequence_order", "integer", (c) => c.notNull())
    .addColumn("difficulty_level", "text", (c) => c.notNull().defaultTo("N5"))
    .addColumn("created_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Create a unique index on formal_name within a single deck to guarantee catalog safety
  await db.schema
    .createIndex("grammar_point_formal_name_deck_idx")
    .on("grammar_point")
    .columns(["deck_id", "formal_name"])
    .unique()
    .execute();

  // 2. Refactor srs_card to map directly to abstract grammar rules rather than static sentences
  await db.schema.alterTable("srs_card").dropColumn("front").execute();
  await db.schema.alterTable("srs_card").dropColumn("back").execute();
  await db.schema.alterTable("srs_card").dropColumn("audio_url").execute();
  await db.schema.alterTable("srs_card").dropColumn("deck_id").execute();

  // Link srs_card to our newly created grammar_point table
  await db.schema
    .alterTable("srs_card")
    .addColumn("grammar_point_id", "uuid", (c) => c.notNull().references("grammar_point.id").onDelete("cascade"))
    .execute();

  // Create index for fast lookups on grammar point schedules
  await db.schema
    .createIndex("srs_card_grammar_point_idx")
    .on("srs_card")
    .column("grammar_point_id")
    .execute();
}

export async function down(db: Kysely<any>) {
  // Revert srs_card structural changes
  await db.schema.alterTable("srs_card").dropColumn("grammar_point_id").execute();
  await db.schema.alterTable("srs_card").addColumn("deck_id", "uuid", (c) => c.references("deck.id").onDelete("cascade")).execute();
  await db.schema.alterTable("srs_card").addColumn("front", "text").execute();
  await db.schema.alterTable("srs_card").addColumn("back", "text").execute();
  await db.schema.alterTable("srs_card").addColumn("audio_url", "text").execute();

  // Drop global grammar_point table
  await db.schema.dropTable("grammar_point").ifExists().execute();
}