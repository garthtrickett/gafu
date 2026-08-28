import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { InvalidCredentialsError } from "../../features/auth/Errors.ts";
import { reserveIntroduction, setLearnerPointStatus } from "../../lib/server/IntroductionAdmissionService.ts";
import { validateToken } from "../../lib/server/JwtService.ts";
import { effectPlugin } from "../middleware/effect-plugin.ts";

export const adaptiveMediaRoutes = new Elysia({ prefix: "/api/adaptive-media" })
  .use(effectPlugin)
  .post("/introductions/reserve", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* reserveIntroduction(user.id, body.knowledgePointId, body.idempotencyKey);
    });
    const result = await runEffect(Effect.either(program));
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 400;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Admission rejected" };
    }
    return result.right;
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      idempotencyKey: t.String({ minLength: 1, maxLength: 200 }),
    }),
  })
  .post("/progress/status", async ({ body, headers, set, runEffect }) => {
    const program = Effect.gen(function* () {
      const authHeader = headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return yield* Effect.fail(new InvalidCredentialsError());
      const user = yield* validateToken(token);
      return yield* setLearnerPointStatus(user.id, body.knowledgePointId, body.action);
    });
    const result = await runEffect(Effect.either(program));
    if (result._tag === "Left") {
      set.status = result.left instanceof InvalidCredentialsError ? 401 : 400;
      return { error: result.left instanceof InvalidCredentialsError ? "Unauthorized" : "Status update rejected" };
    }
    return result.right;
  }, {
    body: t.Object({
      knowledgePointId: t.String({ format: "uuid" }),
      action: t.Union([t.Literal("mark_known"), t.Literal("archive"), t.Literal("reactivate")]),
    }),
  });
