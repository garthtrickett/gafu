import type { Migration } from "kysely";
import * as m00 from "../../migrations/00_init_db";
import * as m01 from "../../migrations/01_dynamic_grammar_srs";
import * as m02 from "../../migrations/02_user_preferences";
import * as m03 from "../../migrations/03_add_hlc_columns";
import * as m04 from "../../migrations/04_add_enforce_mastery_gates";
import * as m05 from "../../migrations/05_add_fsrs_lite_columns";
import * as m06 from "../../migrations/06_backfill_fsrs_lite";

export const migrationObjects: Record<string, Migration> = {
  "00_init_db": { up: m00.up, down: m00.down },
  "01_dynamic_grammar_srs": { up: m01.up, down: m01.down },
  "02_user_preferences": { up: m02.up, down: m02.down },
  "03_add_hlc_columns": { up: m03.up, down: m03.down },
  "04_add_enforce_mastery_gates": { up: m04.up, down: m04.down },
  "05_add_fsrs_lite_columns": { up: m05.up, down: m05.down },
  "06_backfill_fsrs_lite": { up: m06.up, down: m06.down },
};
