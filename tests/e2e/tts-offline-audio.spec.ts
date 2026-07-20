import {
  test,
  expect,
  type Page,
} from "./utils/base-test";

const waitForServiceWorkerControl = async (
  page: Page,
) => {
  await page.waitForFunction(
    () => "serviceWorker" in navigator,
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  if (
    !(await page.evaluate(
      () => navigator.serviceWorker.controller !== null,
    ))
  ) {
    await page.reload({
      waitUntil: "domcontentloaded",
    });
  }

  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
  );
};

const inspectAudioFetch = async (
  page: Page,
  audioUrl: string,
) =>
  page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = (
      await response.arrayBuffer()
    ).byteLength;

    return {
      ok: response.ok,
      status: response.status,
      contentType:
        response.headers.get("content-type"),
      bytes,
    };
  }, audioUrl);

const loadAudioElement = async (
  page: Page,
  audioUrl: string,
) =>
  page.evaluate(
    (url) =>
      new Promise<"ready" | "error" | "timeout">(
        (resolve) => {
          const audio = new Audio();
          const timeout = window.setTimeout(
            () => resolve("timeout"),
            5_000,
          );

          audio.addEventListener(
            "canplaythrough",
            () => {
              window.clearTimeout(timeout);
              resolve("ready");
            },
            { once: true },
          );
          audio.addEventListener(
            "error",
            () => {
              window.clearTimeout(timeout);
              resolve("error");
            },
            { once: true },
          );

          audio.preload = "auto";
          audio.src = url;
          audio.load();
        },
      ),
    audioUrl,
  );

test.describe("offline TTS media boundary", () => {
  test("caches a valid MP3 and replays it after an offline reload", async ({
    page,
    context,
  }) => {
    await page.goto("/", {
      waitUntil: "domcontentloaded",
    });
    await waitForServiceWorkerControl(page);

    // A controlled online navigation populates the NetworkFirst HTML cache.
    await page.reload({
      waitUntil: "domcontentloaded",
    });
    await waitForServiceWorkerControl(page);

    const audioUrl = new URL(
      "/api/__e2e__/tts-audio.mp3",
      page.url(),
    ).toString();

    const online = await inspectAudioFetch(
      page,
      audioUrl,
    );
    expect(online).toMatchObject({
      ok: true,
      status: 200,
      contentType: "audio/mpeg",
    });
    expect(online.bytes).toBeGreaterThan(100);
    expect(
      await loadAudioElement(page, audioUrl),
    ).toBe("ready");

    await expect
      .poll(() =>
        page.evaluate(async (url) => {
          const cache = await caches.open(
            "learning-audio-media",
          );
          return Boolean(await cache.match(url));
        }, audioUrl),
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload({
      waitUntil: "domcontentloaded",
    });

    const offline = await inspectAudioFetch(
      page,
      audioUrl,
    );
    expect(offline).toMatchObject({
      ok: true,
      status: 200,
      contentType: "audio/mpeg",
    });
    expect(offline.bytes).toBe(online.bytes);
    expect(
      await loadAudioElement(page, audioUrl),
    ).toBe("ready");

    await context.setOffline(false);
  });
});
