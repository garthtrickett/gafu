import { Kysely, sql } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>) {
  // Update srs_card rows where difficulty/stability needs backfilling.
  // We apply the exact same mathematical heuristics:
  // D = max(1.0, min(10.0, 5.0 + (2.5 - ease_factor) * 4.0))
  // S = interval_days
  // last_reviewed_at = next_review - (interval_days || ' days')::interval
  await sql`
    UPDATE srs_card
    SET 
      difficulty = LEAST(10.0, GREATEST(1.0, 5.0 + (2.5 - ease_factor) * 4.0)),
      stability = interval_days,
      last_reviewed_at = COALESCE(
        last_reviewed_at, 
        CASE 
          WHEN repetitions > 0 THEN next_review - (interval_days || ' days')::interval 
          ELSE NULL 
        END
      )
    WHERE (difficulty = 5.0 AND stability = 0.0 AND repetitions > 0) OR (stability = 0.0 AND interval_days > 0);
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await sql`
    UPDATE srs_card
    SET 
      difficulty = 5.0,
      stability = 0.0,
      last_reviewed_at = NULL;
  `.execute(db);
}
