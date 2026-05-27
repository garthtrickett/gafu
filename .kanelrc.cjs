require("dotenv").config();
const { makeKyselyHook } = require("kanel-kysely");

const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
let connectionConfig;

if (useLocalProxy) {
  const localDbUrl = new URL(
    process.env.DATABASE_URL_LOCAL ||
      "postgres://postgres:postgres@localhost:6543/main"
  );
  connectionConfig = {
    host: localDbUrl.hostname,
    port: localDbUrl.port ? parseInt(localDbUrl.port, 10) : 6543,
    user: localDbUrl.username,
    password: localDbUrl.password,
    database: localDbUrl.pathname.slice(1),
  };
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[.kanelrc.cjs] DATABASE_URL is not defined in cloud/production environment."
    );
  }
  const cloudDbUrl = new URL(process.env.DATABASE_URL);
  connectionConfig = {
    host: cloudDbUrl.hostname,
    port: cloudDbUrl.port ? parseInt(cloudDbUrl.port, 10) : 5432,
    user: cloudDbUrl.username,
    password: cloudDbUrl.password,
    database: cloudDbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  };
}

/** @type {import('kanel').Config} */
module.exports = {
  connection: connectionConfig,

  schemas: ["public"],

  typeFilter: (pgType) => {
    const lowerName = pgType.name.toLowerCase();
    return (
      lowerName !== "kysely_migration_lock" && lowerName !== "kysely_migration"
    );
  },

  outputPath: "./src/types/generated",

  preDeleteOutputFolder: true,
  preRenderHooks: [makeKyselyHook()],
};
