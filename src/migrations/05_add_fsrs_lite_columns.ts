import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("srs_card")
    .addColumn("difficulty", "double precision", (c) => c.notNull().defaultTo(5.0))
    .addColumn("stability", "double precision", (c) => c.notNull().defaultTo(0.0))
    .addColumn("last_reviewed_at", "timestamp")
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema
    .alterTable("srs_card")
    .dropColumn("difficulty")
    .dropColumn("stability")
    .dropColumn("last_reviewed_at")
    .execute();
}
