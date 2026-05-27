import type { Migration } from "kysely";
import * as m00 from "../../migrations/00_init_db";

export const migrationObjects: Record<string, Migration> = {
  "00_init_db": { up: m00.up, down: m00.down },
};
