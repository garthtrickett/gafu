import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('user_preferences')
    .addColumn('enforce_mastery_gates', 'boolean', (col) => col.defaultTo(true).notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('user_preferences')
    .dropColumn('enforce_mastery_gates')
    .execute();
}
import { Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("user_preference")
    .addColumn("enforce_mastery_gates", "boolean", (c) => c.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema
    .alterTable("user_preference")
    .dropColumn("enforce_mastery_gates")
    .execute();
}

