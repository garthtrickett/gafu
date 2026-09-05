import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { JishoLookupError, lookupJishoTerm } from "../../lib/server/JishoDictionaryService.ts";
import { MAX_LOOKUP_TERM_LENGTH } from "../../lib/shared/jisho.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";

export const jishoRoutes = new Elysia({ prefix: "/api/jisho" })
  .use(effectPlugin)
  // Learner-gated so the proxy cannot be used as an open relay to jisho.org.
  .get("/search", async ({ query, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const token = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      yield* validateToken(token);
      return yield* lookupJishoTerm(query.keyword);
    });
    const result = await runEffect(Effect.either(program), { name: "jisho_search" });
    if (result._tag === "Left") {
      if (result.left instanceof JishoLookupError && result.left.reason === "invalid_term") {
        set.status = 400;
        return { error: result.left.message };
      }
      const unauthorized = result.left instanceof InvalidCredentialsError;
      set.status = unauthorized ? 401 : 502;
      return { error: unauthorized ? "Unauthorized" : "Dictionary lookup failed" };
    }
    return { success: true as const, data: result.right };
  }, {
    query: t.Object({
      keyword: t.String({ minLength: 1, maxLength: MAX_LOOKUP_TERM_LENGTH * 4 }),
    }),
  });
