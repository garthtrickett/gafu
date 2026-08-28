import { sql, type Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await sql`
    ALTER TABLE srs_card
    ADD COLUMN checkout_due boolean NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    CREATE TABLE learner_progress_event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      candidate_id uuid REFERENCES media_candidate(id) ON DELETE SET NULL,
      event_type text NOT NULL CHECK (event_type IN (
        'primer_started', 'primer_retrieval_completed', 'cue_reached',
        'checkout_recalled', 'checkout_missed', 'media_abandoned', 'mark_known',
        'varied_mastery_reached'
      )),
      previous_state text,
      next_state text NOT NULL,
      idempotency_key text NOT NULL,
      occurred_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    )
  `.execute(db);

  await sql`
    CREATE TABLE media_encounter (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      candidate_id uuid REFERENCES media_candidate(id) ON DELETE SET NULL,
      cue_id text NOT NULL,
      timing_transform_id text NOT NULL,
      effective_playback_seconds double precision NOT NULL CHECK (effective_playback_seconds >= 0),
      idempotency_key text NOT NULL,
      reached_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    )
  `.execute(db);

  await sql`
    CREATE TABLE media_checkout (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      candidate_id uuid REFERENCES media_candidate(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
      outcome text CHECK (outcome IN ('recalled', 'missed', 'already_known', 'wrongly_analyzed', 'not_useful')),
      created_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX media_checkout_one_pending_idx
    ON media_checkout (user_id, knowledge_point_id)
    WHERE status = 'pending'
  `.execute(db);
  await sql`
    CREATE INDEX media_checkout_user_pending_idx
    ON media_checkout (user_id, status, created_at)
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`DROP TABLE IF EXISTS media_checkout`.execute(db);
  await sql`DROP TABLE IF EXISTS media_encounter`.execute(db);
  await sql`DROP TABLE IF EXISTS learner_progress_event`.execute(db);
  await sql`ALTER TABLE srs_card DROP COLUMN IF EXISTS checkout_due`.execute(db);
}
