// File: src/lib/server/JishoDictionaryService.ts
// ------------------------------------------------------------------------------
// Server-side proxy for jisho.org word lookups.
// ------------------------------------------------------------------------------
import { Data, Duration, Effect } from "effect";
import {
  extractJapaneseLookupTerm,
  normalizeJishoResponse,
  type JishoLookupResult,
} from "../shared/jisho.ts";

export class JishoLookupError extends Data.TaggedError("JishoLookupError")<{
  readonly reason: "invalid_term" | "unavailable";
  readonly message: string;
}> {}

const JISHO_SEARCH_ENDPOINT = "https://jisho.org/api/v1/search/words";
const LOOKUP_TIMEOUT = Duration.seconds(6);

// Dictionary entries are effectively static, and a study session re-highlights
// the same words constantly. A small bounded cache keeps that off jisho.org.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

interface CachedLookup {
  readonly result: JishoLookupResult;
  readonly expiresAt: number;
}

const cache = new Map<string, CachedLookup>();

export const clearJishoLookupCache = (): void => {
  cache.clear();
};

export type JishoSearchRequest = (keyword: string) => Effect.Effect<unknown, JishoLookupError>;

export const requestJishoSearch: JishoSearchRequest = (keyword) => Effect.gen(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch(`${JISHO_SEARCH_ENDPOINT}?keyword=${encodeURIComponent(keyword)}`, {
      headers: { Accept: "application/json" },
    }),
    catch: (cause) => new JishoLookupError({
      reason: "unavailable",
      message: `Could not reach jisho.org: ${String(cause)}`,
    }),
  });
  if (!response.ok) {
    return yield* Effect.fail(new JishoLookupError({
      reason: "unavailable",
      message: `jisho.org returned HTTP ${response.status}.`,
    }));
  }
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new JishoLookupError({
      reason: "unavailable",
      message: "jisho.org returned an unreadable payload.",
    }),
  });
});

export const lookupJishoTerm = (
  rawTerm: string,
  request: JishoSearchRequest = requestJishoSearch,
  now: () => number = Date.now,
): Effect.Effect<JishoLookupResult, JishoLookupError> => Effect.gen(function* () {
  const term = extractJapaneseLookupTerm(rawTerm);
  if (term === null) {
    return yield* Effect.fail(new JishoLookupError({
      reason: "invalid_term",
      message: "Only short Japanese selections can be looked up.",
    }));
  }

  const timestamp = now();
  const cached = cache.get(term);
  if (cached && cached.expiresAt > timestamp) {
    yield* Effect.logInfo("[JishoDictionary] Served a cached lookup.", { term });
    return cached.result;
  }
  cache.delete(term);

  const payload = yield* request(term).pipe(
    Effect.timeoutFail({
      duration: LOOKUP_TIMEOUT,
      onTimeout: () => new JishoLookupError({
        reason: "unavailable",
        message: "jisho.org did not respond in time.",
      }),
    }),
  );
  const result = normalizeJishoResponse(term, payload);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(term, { result, expiresAt: timestamp + CACHE_TTL_MS });

  yield* Effect.logInfo("[JishoDictionary] Completed a dictionary lookup.", {
    term,
    entryCount: result.entries.length,
  });
  return result;
});
