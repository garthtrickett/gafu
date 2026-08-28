import { sql, type Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await sql`
    CREATE TABLE knowledge_point (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('grammar', 'vocabulary')),
      canonical_key text NOT NULL,
      scope text NOT NULL CHECK (scope IN ('curated', 'personal')),
      owner_user_id uuid REFERENCES "user"(id) ON DELETE CASCADE,
      catalogue_status text NOT NULL DEFAULT 'active'
        CHECK (catalogue_status IN ('active', 'archived', 'quarantined')),
      created_from text NOT NULL DEFAULT 'catalogue'
        CHECK (created_from IN ('catalogue', 'media', 'manual')),
      confidence double precision NOT NULL DEFAULT 1.0
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      hlc text NOT NULL DEFAULT '0000000000000:0000:server',
      CONSTRAINT knowledge_point_scope_owner_check CHECK (
        (scope = 'curated' AND owner_user_id IS NULL) OR
        (scope = 'personal' AND owner_user_id IS NOT NULL)
      )
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX knowledge_point_curated_key_unique_idx
    ON knowledge_point (kind, canonical_key)
    WHERE scope = 'curated'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX knowledge_point_personal_key_unique_idx
    ON knowledge_point (owner_user_id, kind, canonical_key)
    WHERE scope = 'personal'
  `.execute(db);

  await sql`
    INSERT INTO knowledge_point (
      id,
      kind,
      canonical_key,
      scope,
      catalogue_status,
      created_from,
      confidence,
      created_at,
      updated_at,
      hlc
    )
    SELECT
      id,
      'grammar',
      'grammar:' || formal_name,
      'curated',
      'active',
      'catalogue',
      1.0,
      created_at,
      updated_at,
      hlc
    FROM grammar_point
  `.execute(db);

  await sql`
    ALTER TABLE grammar_point
    ADD CONSTRAINT grammar_point_knowledge_point_fk
    FOREIGN KEY (id) REFERENCES knowledge_point(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    CREATE TABLE vocabulary_point (
      knowledge_point_id uuid PRIMARY KEY REFERENCES knowledge_point(id) ON DELETE CASCADE,
      lemma text NOT NULL,
      reading text NOT NULL,
      part_of_speech text NOT NULL,
      sense_key text NOT NULL,
      meaning text NOT NULL,
      register text,
      common_inflections jsonb NOT NULL DEFAULT '[]'::jsonb,
      common_collocations jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX vocabulary_point_lemma_reading_sense_unique_idx
    ON vocabulary_point (lemma, reading, sense_key)
  `.execute(db);

  await sql`
    ALTER TABLE srs_card
    ADD COLUMN knowledge_point_id uuid REFERENCES knowledge_point(id) ON DELETE CASCADE,
    ADD COLUMN participation_status text NOT NULL DEFAULT 'active'
      CHECK (participation_status IN ('active', 'archived')),
    ADD COLUMN learning_state text NOT NULL DEFAULT 'learning'
      CHECK (learning_state IN ('introduced', 'primed', 'encountered', 'learning', 'stable', 'known')),
    ADD COLUMN introduced_at timestamp
  `.execute(db);

  await sql`
    UPDATE srs_card
    SET
      knowledge_point_id = grammar_point_id,
      learning_state = CASE WHEN stability >= 21.0 THEN 'stable' ELSE 'learning' END,
      introduced_at = created_at
  `.execute(db);

  await sql`
    ALTER TABLE srs_card
    ALTER COLUMN knowledge_point_id SET NOT NULL,
    ALTER COLUMN grammar_point_id DROP NOT NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX srs_card_user_knowledge_point_unique_idx
    ON srs_card (user_id, knowledge_point_id)
  `.execute(db);

  await sql`
    CREATE INDEX srs_card_user_priority_idx
    ON srs_card (user_id, participation_status, learning_state, next_review)
  `.execute(db);

  await sql`
    ALTER TABLE user_preference
    ADD COLUMN learner_time_zone text NOT NULL DEFAULT 'UTC'
  `.execute(db);

  await sql`
    CREATE TABLE introduction_admission (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      learner_day date NOT NULL,
      projected_review_cost integer NOT NULL DEFAULT 1 CHECK (projected_review_cost > 0),
      admitted_at timestamp NOT NULL DEFAULT now(),
      idempotency_key text NOT NULL,
      UNIQUE (user_id, knowledge_point_id),
      UNIQUE (user_id, idempotency_key)
    )
  `.execute(db);

  await sql`
    CREATE INDEX introduction_admission_user_day_idx
    ON introduction_admission (user_id, learner_day)
  `.execute(db);

  // Force clients to discard grammar-only pull checkpoints and perform a full
  // pull against the shared knowledge-point contract.
  await sql`UPDATE sync_epoch SET id = gen_random_uuid(), created_at = now()`.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`DROP TABLE IF EXISTS introduction_admission`.execute(db);
  await sql`ALTER TABLE user_preference DROP COLUMN IF EXISTS learner_time_zone`.execute(db);
  await sql`DROP INDEX IF EXISTS srs_card_user_priority_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS srs_card_user_knowledge_point_unique_idx`.execute(db);
  await sql`
    ALTER TABLE srs_card
    ALTER COLUMN grammar_point_id SET NOT NULL,
    DROP COLUMN IF EXISTS introduced_at,
    DROP COLUMN IF EXISTS learning_state,
    DROP COLUMN IF EXISTS participation_status,
    DROP COLUMN IF EXISTS knowledge_point_id
  `.execute(db);
  await sql`DROP TABLE IF EXISTS vocabulary_point`.execute(db);
  await sql`
    ALTER TABLE grammar_point
    DROP CONSTRAINT IF EXISTS grammar_point_knowledge_point_fk
  `.execute(db);
  await sql`DROP TABLE IF EXISTS knowledge_point`.execute(db);
}
