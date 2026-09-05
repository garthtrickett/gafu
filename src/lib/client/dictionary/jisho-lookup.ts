import { Effect } from "effect";
import type { JishoLookupResult } from "../../shared/jisho.ts";

export const requestJishoLookup = (
  token: string,
  term: string,
): Effect.Effect<JishoLookupResult, Error> => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch(`/api/jisho/search?keyword=${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    catch: () => new Error("Dictionary lookups need a connection to Gafu."),
  });
  if (response.status === 401) {
    return yield* Effect.fail(new Error("Sign in again to use dictionary lookups."));
  }
  if (response.status === 400) {
    return yield* Effect.fail(new Error("That highlight is not a Japanese word."));
  }
  if (!response.ok) {
    return yield* Effect.fail(new Error("Jisho could not be reached right now."));
  }
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{
      readonly success?: boolean;
      readonly data?: JishoLookupResult;
    }>,
    catch: () => new Error("Jisho returned an unreadable result."),
  });
  if (!payload.success || !payload.data || !Array.isArray(payload.data.entries)) {
    return yield* Effect.fail(new Error("Jisho returned an invalid result."));
  }
  return payload.data;
});
