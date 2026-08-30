import path from "node:path";
import { test, expect } from "./utils/base-test";
import { cleanupTestUser, createVerifiedSubscriber } from "./utils/seed";

const FIREFOX_OPUS_FIXTURE = Buffer.from(
  "T2dnUwACAAAAAAAAAACvEg7XAAAAAI6vwD8BE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAK8SDtcBAAAAtr3/8wE+T3B1c1RhZ3MNAAAATGF2ZjYwLjE2LjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNjAuMzEuMTAyIGxpYm9wdXNPZ2dTAAT4EwAAAAAAAK8SDtcCAAAAbvEQZwYDAwMDAwP4//74//74//74//74//74//4=",
  "base64",
);

test.describe("adaptive local-media privacy and resilience", () => {
  let user: Awaited<ReturnType<typeof createVerifiedSubscriber>> | undefined;

  test.beforeEach(async () => {
    user = await createVerifiedSubscriber();
  });

  test.afterEach(async () => {
    if (user) await cleanupTestUser(user);
  });

  test("keeps video bytes local and playback UI available when optional AI fails", async ({ page }) => {
    if (!user) throw new Error("Test user was not created.");
    const privateVideoMarker = "PRIVATE_VIDEO_BYTES_MUST_STAY_LOCAL";
    const observedRequests: { url: string; body: string }[] = [];
    page.on("request", (request) => observedRequests.push({
      url: request.url(),
      body: request.postData() ?? "",
    }));

    await page.goto("/login");
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill(user.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL("/");
    await page.goto("/watch");
    await expect(page.getByRole("heading", { name: "Adaptive Japanese playback" })).toBeVisible();

    const inputs = page.locator('input[type="file"]');
    await inputs.nth(1).setInputFiles(path.resolve("src/test/fixtures/adaptive-media/episode.srt"));
    await expect(page.getByRole("status").filter({ hasText: /timed cues prepared locally/i }))
      .toBeVisible({ timeout: 30_000 });
    await inputs.nth(0).setInputFiles({
      name: "private-release-fixture.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from(privateVideoMarker),
    });
    await expect(page.getByText("private-release-fixture.mp4")).toBeVisible();
    await expect(page.locator("video")).toHaveAttribute("src", /^blob:/);
    await page.locator("watch-view").evaluate((element) => {
      const view = element as HTMLElement & {
        cues: readonly object[];
        activeCues: readonly object[];
        requestUpdate: () => void;
      };
      view.activeCues = view.cues.slice(0, 1);
      view.requestUpdate();
    });
    const subtitleOverlay = page.locator("[data-subtitle-overlay]");
    await expect(page.locator("[data-subtitle-cue]")).toBeVisible();
    const fontState = await subtitleOverlay.evaluate(async (overlay) => {
      const loaded = await document.fonts.load('700 64px "Noto Sans JP Variable"', "日本語");
      const redundantReadings = Array.from(overlay.querySelectorAll("[data-subtitle-reading]")).filter((reading) => {
        const surface = reading.parentElement?.querySelector("[data-subtitle-surface]")?.textContent ?? "";
        return !/[々〆ヵヶ一-龯]/u.test(surface);
      }).length;
      return {
        family: getComputedStyle(overlay).fontFamily,
        loadedFaces: loaded.length,
        readingCount: overlay.querySelectorAll("[data-subtitle-reading]").length,
        redundantReadings,
      };
    });
    expect(fontState.family).toContain("Noto Sans JP Variable");
    expect(fontState.loadedFaces).toBeGreaterThan(0);
    expect(fontState.readingCount).toBeGreaterThan(0);
    expect(fontState.redundantReadings).toBe(0);
    const subtitleSize = page.getByText("Subtitle size").locator('input[type="range"]');
    await subtitleSize.evaluate((input: HTMLInputElement) => {
      input.value = input.max;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(subtitleOverlay).toHaveAttribute("style", /14cqw/);
    const normalSubtitle = await subtitleOverlay.evaluate((overlay) => ({
      fontSize: Number.parseFloat(getComputedStyle(overlay).fontSize),
      surfaceFontSize: Number.parseFloat(getComputedStyle(overlay.querySelector("[data-subtitle-surface]")!).fontSize),
      surfaceHeight: overlay.querySelector("[data-subtitle-surface]")!.getBoundingClientRect().height,
      multilineFuriganaClearance: (() => {
        const lines = Array.from(overlay.querySelectorAll("[data-subtitle-line]"));
        const upperSurfaces = Array.from(lines[0]?.querySelectorAll("[data-subtitle-surface]") ?? []);
        const lowerReadings = Array.from(lines[1]?.querySelectorAll("[data-subtitle-reading]") ?? []);
        if (upperSurfaces.length === 0 || lowerReadings.length === 0) return Number.NaN;
        const upperSurfaceBottom = Math.max(...upperSurfaces.map((surface) => surface.getBoundingClientRect().bottom));
        const lowerReadingTop = Math.min(...lowerReadings.map((reading) => reading.getBoundingClientRect().top));
        return lowerReadingTop - upperSurfaceBottom;
      })(),
      whitespaceNodes: Array.from(overlay.querySelector("[data-subtitle-line]")!.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE && /\s/u.test(node.textContent ?? "")).length,
    }));
    expect(normalSubtitle.fontSize).toBeGreaterThanOrEqual(80);
    expect(normalSubtitle.surfaceFontSize).toBe(normalSubtitle.fontSize);
    expect(normalSubtitle.surfaceHeight).toBeGreaterThanOrEqual(normalSubtitle.surfaceFontSize * 0.9);
    expect(normalSubtitle.multilineFuriganaClearance).toBeGreaterThanOrEqual(normalSubtitle.fontSize * 0.25);
    expect(normalSubtitle.whitespaceNodes).toBe(0);

    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute("data-video-stage")))
      .toBe(true);
    await expect(page.locator("[data-video-stage]:fullscreen [data-subtitle-cue]")).toBeVisible();
    const fullscreenFontSize = await subtitleOverlay.evaluate((overlay) =>
      Number.parseFloat(getComputedStyle(overlay).fontSize));
    expect(fullscreenFontSize).toBeGreaterThan(normalSubtitle.fontSize);
    await page.evaluate(() => document.exitFullscreen());

    await page.route("**/api/adaptive-media/analysis/recommendations", (route) => route.abort("failed"));
    await page.getByText("Send at most 12 shortlisted subtitle excerpts").locator("input").check();
    await page.getByRole("button", { name: "Analyze consented excerpts" }).click();
    await expect(page.getByRole("status").filter({ hasText: /failed|unreachable|unavailable/i })).toBeVisible();
    await expect(page.locator("video")).toHaveAttribute("src", /^blob:/);

    expect(observedRequests.some((request) => request.body.includes(privateVideoMarker))).toBe(false);
    expect(observedRequests.some((request) => request.url.includes("private-release-fixture.mp4"))).toBe(false);

    await page.getByText("Encounter markers").locator("input").uncheck();
    await expect(page.getByText("Encounter markers").locator("input")).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflows).toBe(false);
  });

  test("activates synchronized Opus audio for a silent Firefox MKV", async ({ page }) => {
    if (!user) throw new Error("Test user was not created.");
    await page.route("**/api/local-media/repair-audio", (route) => route.fulfill({
      status: 200,
      contentType: "audio/ogg",
      body: FIREFOX_OPUS_FIXTURE,
    }));
    await page.goto("/login");
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill(user.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL("/");
    await page.goto("/watch");

    await page.locator('input[type="file"]').nth(0).setInputFiles({
      name: "silent-firefox.mkv",
      mimeType: "video/x-matroska",
      buffer: Buffer.from("local test container"),
    });
    await page.getByRole("button", { name: "Fix audio in Firefox" }).click();

    await expect(page.getByRole("button", { name: "Audio fixed ✓" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Firefox-compatible audio is ready" })).toBeVisible();
    const playback = await page.locator("watch-view").evaluate((view) => {
      const video = view.querySelector("video");
      const audio = view.querySelector("audio[data-repaired-audio]") as HTMLAudioElement | null;
      return {
        videoMuted: video?.muted,
        audioSource: audio?.getAttribute("src"),
        audioDuration: audio?.duration,
      };
    });
    expect(playback.videoMuted).toBe(true);
    expect(playback.audioSource).toMatch(/^blob:/u);
    expect(playback.audioDuration).toBeGreaterThan(0);
  });
});
