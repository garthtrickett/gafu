import "dotenv/config"; // Ensure variables are loaded before evaluating connection strings
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { Effect } from "effect";
import type { Database } from "../types";

export const makeDbLive = Effect.gen(function* () {
  const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
  const connectionString = useLocalProxy
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

  if (!connectionString) {
    yield* Effect.logError(
      "[makeDbLive] FATAL: DATABASE_URL or DATABASE_URL_LOCAL must be set"
    );
    throw new Error("DATABASE_URL or DATABASE_URL_LOCAL must be set");
  }

  const redactedUrl = connectionString.replace(/:([^@]+)@/, ":****@");
  yield* Effect.logWarning(
    `[makeDbLive] Initializing Kysely with connection: ${redactedUrl} (Local Proxy: ${useLocalProxy})`
  );

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
    }),
  });

  return new Kysely<Database>({
    dialect,
    log: (event) => {
      if (event.level === "error") {
        console.error("[Kysely Error]", event.error);
      }
    },
  });
});
