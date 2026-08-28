import { test, expect } from "./utils/base-test";

test.describe("Grammar Explanation Study Flow", () => {
  test("should allow importing a session, viewing explanation, and advancing", async ({ page }) => {
    const email = `test-user-${Date.now()}@test.com`;
    const password = "Password123!";

    // 1. Navigate to signup page and register
    await page.goto("/signup");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();

    // 2. Log in
    await expect(page).toHaveURL(/\/login/);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();

    // 3. Confirm we are on the dashboard
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Language Study Desk");

    // 4. Construct a mock session payload with a grammar explanation
    const mockPayload = {
      cards: [
        {
          grammar_point_id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11",
          english_context: "Stating that you are a student.",
          japanese_sentence: "学生です。",
          furigana: [
            { "kanji": "学生", "kana": "がくせい" },
            { "kanji": "です" }
          ],
          audio_url: null,
          explanation: "The copula 'です' is used to declare state of being 'is/am/are'."
        }
      ]
    };

    // 5. Paste payload and submit the import form
    await page.locator("textarea").fill(JSON.stringify(mockPayload));
    await page.locator('button[type="submit"]', { hasText: "Import & Start Study" }).click();

    // 6. Verify transition to study interface
    await expect(page).toHaveURL(/\/study/);
    await expect(page.getByText("Stating that you are a student.", { exact: true })).toBeVisible();

    // 7. Verify the explanation panel is not visible initially
    await expect(page.locator("text=Grammar Explanation")).not.toBeVisible();

    // 8. Click the Explain button to reveal the explanation
    await page.locator("button", { hasText: "Explain" }).click();
    await expect(page.locator("text=Grammar Explanation")).toBeVisible();
    await expect(page.locator("p.leading-relaxed")).toContainText("The copula 'です' is used to declare state of being 'is/am/are'.");

    // 9. Click the Correct button to finish the session
    await page.getByRole("button", { name: /^Correct/ }).click();

    // 10. Verify the completed session screen is shown
    await expect(page.locator("h2")).toContainText("Review Completed!");
  });
});
