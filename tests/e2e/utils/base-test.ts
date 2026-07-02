import { test as base } from "@playwright/test";

const clearBrowserState = async (page: import("@playwright/test").Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    if (!indexedDB.databases) {
      return;
    }

    const databases = await indexedDB.databases();
    await Promise.all(
      databases
        .map((database) => database.name)
        .filter((name): name is string => Boolean(name))
        .map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              request.onblocked = () => {
                console.warn(`[E2E] IndexedDB deletion blocked for ${name}. Continuing with isolated test context.`);
                resolve();
              };
            })
        )
    );
  });
};

const attachLogs = (page: import("@playwright/test").Page, name: string) => {
  page.on("console", (msg) => {
    if (!msg.text().includes("[vite]")) {
      console.log(`[Browser: ${name}] ${msg.type().toUpperCase()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error(`[Browser: ${name} ERROR] Unhandled Exception:`, err);
  });
};

export const test = base.extend({
  page: async ({ context, page }, use) => {
    await context.clearCookies();
    attachLogs(page, "Default");
    await clearBrowserState(page);
    await use(page);
  },
  browser: async ({ browser }, use) => {
    const originalNewContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await originalNewContext(options);
      context.on("page", (page) => attachLogs(page, "Manual"));
      return context;
    };
    await use(browser);
  }
});

export { expect, type Page, type BrowserContext } from "@playwright/test";
