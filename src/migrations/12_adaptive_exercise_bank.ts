import { sql, type Kysely } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  await sql`
    CREATE TABLE generated_exercise (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      context text NOT NULL,
      japanese_sentence text NOT NULL,
      target_start integer NOT NULL CHECK (target_start >= 0),
      target_end integer NOT NULL CHECK (target_end > target_start),
      answer text NOT NULL,
      explanation text NOT NULL,
      furigana jsonb NOT NULL DEFAULT '[]'::jsonb,
      modality text NOT NULL CHECK (modality IN ('text_recognition', 'listening_recognition', 'production')),
      variation_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      variation_profile jsonb NOT NULL,
      prerequisite_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_signature_version text NOT NULL,
      source_normalization_version text NOT NULL,
      source_semantic_model_version text NOT NULL,
      validation_status text NOT NULL DEFAULT 'accepted' CHECK (validation_status = 'accepted'),
      generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      content_fingerprint text NOT NULL,
      frame_fingerprint text NOT NULL,
      material_context_key text NOT NULL,
      use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
      last_used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (user_id, knowledge_point_id, content_fingerprint)
    )
  `.execute(db);
  await sql`
    CREATE INDEX generated_exercise_selection_idx
    ON generated_exercise (user_id, knowledge_point_id, validation_status, last_used_at, use_count)
  `.execute(db);

  await sql`
    CREATE TABLE retrieval_evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      knowledge_point_id uuid NOT NULL REFERENCES knowledge_point(id) ON DELETE CASCADE,
      exercise_id uuid NOT NULL REFERENCES generated_exercise(id) ON DELETE CASCADE,
      result text NOT NULL CHECK (result IN ('recalled', 'missed')),
      response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
      modality text NOT NULL CHECK (modality IN ('text_recognition', 'listening_recognition', 'production')),
      material_context_key text NOT NULL,
      scheduling_change jsonb NOT NULL,
      idempotency_key text NOT NULL,
      reviewed_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)
    )
  `.execute(db);
  await sql`
    CREATE INDEX retrieval_evidence_mastery_idx
    ON retrieval_evidence (user_id, knowledge_point_id, result, material_context_key, reviewed_at)
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`DROP TABLE IF EXISTS retrieval_evidence`.execute(db);
  await sql`DROP TABLE IF EXISTS generated_exercise`.execute(db);
}
