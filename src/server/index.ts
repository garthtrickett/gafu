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

export const app = new Elysia()
  .onError(({ code, error, request }) => {
    console.error(`[Global Error] ${request.method} ${request.url} - ${code}`, error);
  })
  .onRequest(({ request }) => {
    console.info(`📡 [HTTP] ${request.method} ${request.url}`);
  })
  .post("/api/log", ({ body }) => {
    const { level, message, data, url } = body as {
      level: string;
      message: string;
      data: any;
      url: string;
    };
    const formattedData = data && Object.keys(data).length ? JSON.stringify(data, null, 2) : "";
    console.info(`📱 [Client ${level.toUpperCase()}] ${message} ${formattedData} (URL: ${url})`);
    return { success: true };
  })
    .use(authRoutes)
  .use(syncRoutes)
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
  app.listen(42069);
  console.info(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
}

export type App = typeof app;
