import { Kysely, sql } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .createTable("tts_daily_usage")
    .ifNotExists()
    .addColumn("usage_date", "date", (column) =>
      column.primaryKey(),
    )
    .addColumn("attempted_count", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("updated_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "tts_daily_usage_attempted_count_non_negative",
      sql`attempted_count >= 0`,
    )
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema
    .dropTable("tts_daily_usage")
    .ifExists()
    .execute();
}
