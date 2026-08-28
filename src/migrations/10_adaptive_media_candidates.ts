import { sql, type Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  // Personal grammar discoveries do not belong to a curated deck or sequence.
  await sql`
    ALTER TABLE grammar_point
      ALTER COLUMN deck_id DROP NOT NULL,
      ALTER COLUMN lesson_number SET DEFAULT 0,
      ALTER COLUMN sequence_order SET DEFAULT 0
  `.execute(db);

  await sql`
    CREATE TABLE media_analysis_run (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      subtitle_track_fingerprint text NOT NULL,
      normalization_version text NOT NULL,
      status text NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (id, user_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE media_candidate (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      analysis_run_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('grammar', 'vocabulary')),
      canonical_key text NOT NULL,
      reading text,
      meaning text NOT NULL,
      confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      review_cost_class text NOT NULL
        CHECK (review_cost_class IN ('light_vocabulary', 'difficult_vocabulary', 'grammar')),
      disposition text NOT NULL DEFAULT 'pending'
        CHECK (disposition IN ('pending', 'accepted', 'rejected', 'already_known', 'not_useful', 'wrongly_analyzed')),
      resolved_knowledge_point_id uuid REFERENCES knowledge_point(id) ON DELETE SET NULL,
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      first_encounter_seconds double precision NOT NULL CHECK (first_encounter_seconds >= 0),
      occurrence_count integer NOT NULL CHECK (occurrence_count > 0),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (user_id, analysis_run_id, kind, canonical_key),
      FOREIGN KEY (analysis_run_id, user_id)
        REFERENCES media_analysis_run(id, user_id) ON DELETE CASCADE
    )
  `.execute(db);

  await sql`
    CREATE INDEX media_candidate_user_disposition_idx
    ON media_candidate (user_id, disposition, created_at)
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`DROP TABLE IF EXISTS media_candidate`.execute(db);
  await sql`DROP TABLE IF EXISTS media_analysis_run`.execute(db);
  await sql`
    ALTER TABLE grammar_point
      ALTER COLUMN sequence_order DROP DEFAULT,
      ALTER COLUMN lesson_number DROP DEFAULT,
      ALTER COLUMN deck_id SET NOT NULL
  `.execute(db);
}
