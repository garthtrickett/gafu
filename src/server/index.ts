import { Elysia } from "elysia";
import { existsSync, mkdirSync } from "node:fs";

// Ensure the dist/assets directory exists so @elysiajs/static doesn't crash on startup during development
if (!existsSync("./dist/assets")) {
  mkdirSync("./dist/assets", { recursive: true });
}
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { effectPlugin } from "./middleware/effect-plugin";
import { authRoutes } from "./routes/auth";
import { syncRoutes } from "./routes/sync.ts";
import { aiRoutes } from "./routes/ai";
import { db } from "../db/client";
import { seedDb } from "../db/seed";
import { serverRuntime } from "../lib/server/server-runtime";
import { Effect } from "effect";

export const app = new Elysia()
  .onError(({ code, error, request }) => {
    console.error(`[Global Error] ${request.method} ${request.url} - ${code}`, error);
  })
  .onRequest(({ request }) => {
    console.info(`📡 [HTTP] ${request.method} ${request.url}`);
  })
    .post("/api/log", ({ body }) => {
    const logPayload = body as {
      level: string;
      message: string;
      data: Record<string, unknown> | null | undefined;
      url: string;
    };
    const level = logPayload.level;
    const message = logPayload.message;
    const data = logPayload.data;
    const url = logPayload.url;
    const formattedData = data && Object.keys(data).length ? JSON.stringify(data, null, 2) : "";
    console.info(`📱 [Client ${level.toUpperCase()}] ${message} ${formattedData} (URL: ${url})`);
    return { success: true };
  })
  .use(authRoutes)
  .use(syncRoutes)
  .use(aiRoutes)
  .use(cors({
    origin: [
      /localhost.*/,
      /127\.0\.0\.1.*/,
      /.*\.life-io\.xyz/,
      "https://life-io.xyz",
      "capacitor://localhost",
      "http://localhost",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Life-IO-Subdomain", "Cache-Control", "Pragma", "Expires"],
    credentials: true,
  }))
  .use(effectPlugin)
  .use(
    staticPlugin({
      assets: "./dist/assets",
      prefix: "/assets",
        })
      )
  .get("/manifest.webmanifest", () => Bun.file("./dist/manifest.webmanifest"))
  .get("/sw.js", () => Bun.file("./dist/sw.js"))
  .get("/favicon.ico", () => Bun.file("./dist/favicon.ico"))
  .get("/icon-192.png", () => Bun.file("./dist/icon-192.png"))
  .get("/icon-512.png", () => Bun.file("./dist/icon-512.png"))
  .get("/apple-touch-icon.png", () => Bun.file("./dist/apple-touch-icon.png"))
    .get("*", ({ set }) => {
    set.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    set.headers["Pragma"] = "no-cache";
    set.headers["Expires"] = "0";
    if (existsSync("./dist/index.html")) {
      return Bun.file("./dist/index.html");
    }
    return "Development Server: Build output is not present in `./dist`. Use the Vite dev server on port 3000.";
  });

if (process.env.NODE_ENV !== "test") {
  const port = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 42069;

  const startupEffect = Effect.gen(function* () {
    const gpCountResult = yield* Effect.tryPromise({
      try: () => db.selectFrom("grammar_point").select(({ fn }) => fn.countAll().as("count")).executeTakeFirst(),
      catch: (error) => new Error("Database query failed during self-healing check", { cause: error })
    });
    const count = parseInt(String(gpCountResult?.count || "0"), 10);
    if (count === 0) {
      yield* Effect.logWarning("⚠️ [Self-Healing] No grammar points detected. Seeding database...");
      yield* seedDb({ clearData: false });
      yield* Effect.logInfo("✅ [Self-Healing] Database seeded successfully.");
    }
  }).pipe(
    Effect.catchAll((err) => {
      const serializeError = (error: unknown): Record<string, unknown> | string => {
        if (error instanceof Error) {
          const result: Record<string, unknown> = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          };
          const errObj = error as unknown as Record<string, unknown>;
          const code = errObj["code"];
          if (typeof code === "string") {
            result["code"] = code;
          }
          const detail = errObj["detail"];
          if (typeof detail === "string") {
            result["detail"] = detail;
          }
          const cause = errObj["cause"];
          if (cause !== undefined) {
            result["cause"] = serializeError(cause);
          }
          return result;
        }
        if (typeof error === "object" && error !== null) {
          const errObj = error as Record<string, unknown>;
          const result: Record<string, unknown> = {};
          for (const key of Object.keys(errObj)) {
            const val = errObj[key];
            result[key] = typeof val === "object" && val !== null ? serializeError(val) : val;
          }
          return result;
        }
        return String(error);
      };

      return Effect.logError("Failed to run self-healing seeder", {
        error: serializeError(err)
      });
    })
  );

  void serverRuntime.runPromise(startupEffect).then(() => {
    app.listen(port);
    console.info(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
  });
}

export type App = typeof app;
