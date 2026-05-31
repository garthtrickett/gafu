import type { Migration } from "kysely";
import * as m00 from "../../migrations/00_init_db";
import * as m01 from "../../migrations/01_dynamic_grammar_srs";
import * as m02 from "../../migrations/02_user_preferences";

export const migrationObjects: Record<string, Migration> = {
  "00_init_db": { up: m00.up, down: m00.down },
  "01_dynamic_grammar_srs": { up: m01.up, down: m01.down },
  "02_user_preferences": { up: m02.up, down: m02.down },
};
