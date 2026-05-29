// File: scripts/fetch-bunpro.ts
// ------------------------------------------------------------------------------
// Standalone script to pull user statistics from the Bunpro Frontend API
// ------------------------------------------------------------------------------
import { Effect, Exit } from "effect";

// Active Frontend API token and Base URL
const BUNPRO_FRONTEND_TOKEN = process.env.BUNPRO_FRONTEND_TOKEN || "67866aaeae3484233c54ad2932999c9d";
const BASE_URL = "https://api.bunpro.jp/api/frontend";

/**
 * Executes a fetch request targeting a specific Bunpro Frontend endpoint.
 * Note that endpoint paths must match the reverse-engineered OpenAPI spec:
 * - "/user"
 * - "/user/queue"
 * - "/user/due"
 * - "/user_stats/base_stats"
 */
const fetchFromBunpro = <T>(endpointPath: string) =>
  Effect.gen(function* () {
    const url = `${BASE_URL}${endpointPath}`;
    
    // Mask the token in log outputs to prevent exposure
    const maskedToken = BUNPRO_FRONTEND_TOKEN.length > 8 
      ? `${BUNPRO_FRONTEND_TOKEN.substring(0, 6)}...` 
      : "****";
      
    yield* Effect.logInfo(`[BunproAPI] Fetching endpoint: ${url} with token: ${maskedToken}`);

    if (BUNPRO_FRONTEND_TOKEN === "PASTE_YOUR_FRONTEND_TOKEN_HERE" || !BUNPRO_FRONTEND_TOKEN) {
      return yield* Effect.fail(new Error("Token is not configured. Please ensure BUNPRO_FRONTEND_TOKEN has been set."));
    }

    const response = yield* Effect.tryPromise({
      try: () => fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Token token=${BUNPRO_FRONTEND_TOKEN}`,
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      }),
      catch: (error) => new Error(`Network request failed for endpoint ${endpointPath}: ${String(error)}`),
    });

    if (!response.ok) {
      return yield* Effect.fail(new Error(`Bunpro server returned HTTP status ${response.status} for ${endpointPath}`));
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: (error) => new Error(`Failed to parse JSON payload for ${endpointPath}: ${String(error)}`),
    });

    return payload;
  });

/**
 * Orchestrates fetching multiple endpoints and logging formatted results.
 */
interface BunproUserEnvelope {
  readonly user?: {
    readonly data?: {
      readonly attributes?: {
        readonly id?: string | number;
        readonly username?: string;
        readonly level?: number;
        readonly xp?: number;
        readonly next_level_xp?: number;
        readonly is_lifetime?: boolean;
        readonly has_active_subscription?: boolean;
      };
    };
  };
}

/**
 * Orchestrates fetching multiple endpoints and logging formatted results.
 */
const runQueryPipeline = Effect.gen(function* () {
  yield* Effect.logInfo("[BunproAPI] Initializing Bunpro Frontend API query pipeline...");

  // Fetch using the exact paths defined in the OpenAPI spec
  const userEnvelope = yield* fetchFromBunpro<BunproUserEnvelope>("/user");
  yield* Effect.logInfo("[BunproAPI] User profile envelope retrieved successfully.");

  const queueResult = yield* fetchFromBunpro<unknown>("/user/queue");
  yield* Effect.logInfo("[BunproAPI] Review queue stats retrieved successfully.");

  const dueResult = yield* fetchFromBunpro<unknown>("/user/due");
  yield* Effect.logInfo("[BunproAPI] Due counts retrieved successfully.");

  const baseStatsResult = yield* fetchFromBunpro<unknown>("/user_stats/base_stats").pipe(
    Effect.catchAll(() => Effect.succeed(null))
  );

  // Extract attributes from the JSON:API envelope schema
  const userAttributes = userEnvelope?.user?.data?.attributes;

  yield* Effect.logInfo(`
=========================================
👤 BUNPRO USER PROFILE
=========================================
ID:                       ${userAttributes?.id || "N/A"}
Username:                 ${userAttributes?.username || "N/A"}
Level:                    ${userAttributes?.level || "N/A"}
XP:                       ${userAttributes?.xp || "N/A"}
Next Level XP:            ${userAttributes?.next_level_xp || "N/A"}
Lifetime Member:          ${userAttributes?.is_lifetime ? "Yes" : "No"}
Active Subscription:      ${userAttributes?.has_active_subscription ? "Yes" : "No"}
  `);

  // Print Queue and Due counts cleanly as raw JSON to examine the full structure
  yield* Effect.logInfo(`
=========================================
📚 CURRENT STUDY QUEUE
=========================================
Raw Queue Payload:        ${JSON.stringify(queueResult, null, 2)}
Raw Due Payload:          ${JSON.stringify(dueResult, null, 2)}
=========================================
  `);

  if (baseStatsResult) {
    yield* Effect.logInfo(`
=========================================
📈 BASE STATISTICS
=========================================
Raw Stats Payload:        ${JSON.stringify(baseStatsResult, null, 2)}
=========================================
    `);
  }
});

// Run pipeline within the local runtime context
void Effect.runPromiseExit(runQueryPipeline).then((exit) => {
  if (Exit.isSuccess(exit)) {
    console.info("🎉 Query pipeline completed successfully.");
    process.exit(0);
  } else {
    console.error("❌ Pipeline execution failed:");
    console.error(exit.cause);
    process.exit(1);
  }
});
