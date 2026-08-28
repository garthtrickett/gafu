import { Effect } from "effect";
import { clientLog } from "../clientLog.ts";
import type {
  DailySessionGeneration,
  DailySessionGenerationRequest,
} from "../../server/ai/schema.ts";

interface DailySessionGenerationApiResponse {
  readonly success?: boolean;
  readonly data?: DailySessionGeneration;
  readonly error?: string;
}

export const requestDailySessionGeneration = (
  token: string,
  request: DailySessionGenerationRequest,
): Effect.Effect<DailySessionGeneration, Error> =>
  Effect.gen(function* () {
    if (!token.trim()) {
      return yield* Effect.fail(
        new Error("AI session generation requires an authenticated session."),
      );
    }

    yield* clientLog(
      "info",
      `[DailySessionGeneration] Requesting ${request.queue.length} cards from the server.`,
    );
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/ai/generate-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request),
        }),
      catch: (cause) =>
        new Error(
          `AI session generation could not reach the server: ${String(cause)}`,
        ),
    });

    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<DailySessionGenerationApiResponse>,
      catch: (cause) =>
        new Error(
          `AI session generation returned invalid JSON: ${String(cause)}`,
        ),
    });

    if (!response.ok) {
      yield* clientLog(
        "warn",
        `[DailySessionGeneration] Server rejected generation with HTTP ${response.status}.`,
      );
      return yield* Effect.fail(
        new Error(
          payload.error ??
            `AI session generation failed with HTTP ${response.status}.`,
        ),
      );
    }

    if (
      payload.success !== true ||
      !payload.data ||
      !Array.isArray(payload.data.cards)
    ) {
      return yield* Effect.fail(
        new Error("AI session generation returned an invalid response."),
      );
    }

    yield* clientLog(
      "info",
      `[DailySessionGeneration] Received ${payload.data.cards.length} generated cards.`,
    );
    return payload.data;
  });
