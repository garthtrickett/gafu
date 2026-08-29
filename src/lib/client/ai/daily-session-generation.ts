import { Effect } from "effect";
import { clientLog } from "../clientLog.ts";
import {
  DailySessionGenerationDraftSchema,
  type DailySessionGenerationDraft,
  type DailySessionGeneration,
  type DailySessionGenerationRequest,
} from "../../server/ai/schema.ts";
import { enrichDailySessionFurigana } from "./daily-session-furigana.ts";

interface DailySessionGenerationApiResponse {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

export type DailySessionFuriganaEnricher = (
  draft: DailySessionGenerationDraft,
) => Effect.Effect<DailySessionGeneration, Error>;

export const requestDailySessionGeneration = (
  token: string,
  request: DailySessionGenerationRequest,
  furiganaEnricher: DailySessionFuriganaEnricher =
    enrichDailySessionFurigana,
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
          (typeof payload.error === "string" ? payload.error : undefined) ??
            `AI session generation failed with HTTP ${response.status}.`,
        ),
      );
    }

    if (payload.success !== true) {
      return yield* Effect.fail(
        new Error("AI session generation returned an invalid response."),
      );
    }

    const parsedDraft = DailySessionGenerationDraftSchema.safeParse(
      payload.data,
    );
    if (!parsedDraft.success) {
      yield* clientLog(
        "warn",
        "[DailySessionGeneration] Server response failed the session draft schema.",
        parsedDraft.error,
      );
      return yield* Effect.fail(
        new Error("AI session generation returned an invalid response."),
      );
    }

    yield* clientLog(
      "info",
      `[DailySessionGeneration] Received ${parsedDraft.data.cards.length} generated card drafts; deriving furigana locally.`,
    );
    return yield* furiganaEnricher(parsedDraft.data);
  });
