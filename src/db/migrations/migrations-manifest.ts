import type { Migration } from "kysely";
import * as m00 from "../../migrations/00_init_db";
import * as m01 from "../../migrations/01_dynamic_grammar_srs";
import * as m02 from "../../migrations/02_user_preferences";
import * as m03 from "../../migrations/03_add_hlc_columns";
import * as m04 from "../../migrations/04_add_enforce_mastery_gates";
import * as m05 from "../../migrations/05_add_fsrs_lite_columns";
import * as m06 from "../../migrations/06_backfill_fsrs_lite";
import * as m07 from "../../migrations/07_add_sync_epoch";
import * as m08 from "../../migrations/08_add_tts_daily_usage";
import * as m09 from "../../migrations/09_adaptive_knowledge_points";
import * as m10 from "../../migrations/10_adaptive_media_candidates";
import * as m11 from "../../migrations/11_adaptive_media_learning_loop";
import * as m12 from "../../migrations/12_adaptive_exercise_bank";

export const migrationObjects: Record<string, Migration> = {
  "00_init_db": { up: m00.up, down: m00.down },
  "01_dynamic_grammar_srs": { up: m01.up, down: m01.down },
  "02_user_preferences": { up: m02.up, down: m02.down },
  "03_add_hlc_columns": { up: m03.up, down: m03.down },
  "04_add_enforce_mastery_gates": { up: m04.up, down: m04.down },
  "05_add_fsrs_lite_columns": { up: m05.up, down: m05.down },
  "06_backfill_fsrs_lite": { up: m06.up, down: m06.down },
  "07_add_sync_epoch": { up: m07.up, down: m07.down },
  "08_add_tts_daily_usage": { up: m08.up, down: m08.down },
  "09_adaptive_knowledge_points": { up: m09.up, down: m09.down },
  "10_adaptive_media_candidates": { up: m10.up, down: m10.down },
  "11_adaptive_media_learning_loop": { up: m11.up, down: m11.down },
  "12_adaptive_exercise_bank": { up: m12.up, down: m12.down },
};
