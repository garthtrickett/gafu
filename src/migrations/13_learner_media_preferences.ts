import { sql, type Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await sql`
    CREATE TABLE learner_media_preference (
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('grammar', 'vocabulary')),
      canonical_key text NOT NULL,
      disposition text NOT NULL CHECK (disposition = 'not_useful'),
      hlc text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, kind, canonical_key),
      CHECK (canonical_key LIKE kind || ':%')
    )
  `.execute(db);

  await sql`
    CREATE INDEX learner_media_preference_user_hlc_idx
    ON learner_media_preference (user_id, hlc)
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`DROP TABLE IF EXISTS learner_media_preference`.execute(db);
}
