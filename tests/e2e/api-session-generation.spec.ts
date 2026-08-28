import { test, expect } from "./utils/base-test.ts";
import {
  cleanupTestUser,
  createVerifiedSubscriber,
} from "./utils/seed.ts";

test.describe("API-generated study session", () => {
  let testUser: {
    email: string;
    password: string;
    userId: string;
  };

  test.beforeAll(async () => {
    testUser = await createVerifiedSubscriber();
  });

  test.afterAll(async () => {
    await cleanupTestUser(testUser);
  });

  test("generates, validates, and starts a daily session without clipboard transfer", async ({ page }) => {
    let capturedRequestBody = "";

    await page.route("**/api/ai/generate-session", async (route) => {
      capturedRequestBody = route.request().postData() ?? "";
      const parsed = JSON.parse(capturedRequestBody) as {
        queue: readonly {
          grammar_point_id: string;
          formal_name: string;
        }[];
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            cards: parsed.queue.map((item, index) => ({
              grammar_point_id: item.grammar_point_id,
              english_context: `Generated context ${index + 1} for ${item.formal_name}.`,
              japanese_sentence: "学生です。",
              furigana: [
                { kanji: "学生", kana: "がくせい" },
                { kanji: "です。" },
              ],
              audio_url: null,
              explanation: `${item.formal_name} is used in this generated sentence.`,
            })),
          },
        }),
      });
    });

    await page.route("**/api/tts/enrich-session", async (route) => {
      const parsed = JSON.parse(route.request().postData() ?? "{}") as {
        items?: readonly { requestId: string }[];
      };
      const items = parsed.items ?? [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: items.map((item) => ({
              requestId: item.requestId,
              audioUrl: null,
              failureKind: "provider",
            })),
            requestedCount: items.length,
            enrichedCount: 0,
            failedCount: items.length,
          },
        }),
      });
    });

    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", {
      name: /Generate & Start Session/,
    }).click();

    await expect(page).toHaveURL("/study");
    await expect(
      page.getByText(/Generated context \d+ for/),
    ).toBeVisible();
    expect(capturedRequestBody).not.toContain("OPENAI_API_KEY");
    expect(capturedRequestBody).not.toContain("sk-");
  });
});
