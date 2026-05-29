import { test, expect } from "./utils/base-test";
import { createVerifiedSubscriber } from "./utils/seed";

test.describe("Manual Handshake Study Session Loop", () => {
  let testUser: any;

  test.beforeAll(async () => {
    testUser = await createVerifiedSubscriber();
  });

  test("should copy progress, accept imported session, and log completed card to Outbox", async ({ page }) => {
    // 1. Log in with seeded user credentials
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Language Study Desk");

    // 2. Check the "Copy Progress" button is present
    const copyBtn = page.locator("button", { hasText: "Copy Progress Payload" });
    await expect(copyBtn).toBeVisible();

    // 3. Inject a valid study session payload into the textarea
    const mockSessionPayload = {
      session_id: "test-session-123",
      cards: [
        {
          grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", // Seeded 'だ'
          english_context: "E2E Testing Context: Describing the situation.",
          japanese_sentence: "これはテストです。",
          furigana: [
            { kanji: "これ" },
            { kanji: "は" },
            { kanji: "テスト" },
            { kanji: "です" }
          ],
          audio_url: null
        }
      ]
    };

    const textarea = page.locator("textarea");
    await textarea.fill(JSON.stringify(mockSessionPayload));

    // 4. Click the "Import & Start Study" button
    const startBtn = page.locator("button", { hasText: "Import & Start Study" });
    await startBtn.click();

    // 5. Confirm transition to the active study session view
    await expect(page).toHaveURL("/study");
    
    // Validate card front shows the injected situational context
    await expect(page.locator("p")).toContainText("E2E Testing Context");

    // 6. Grade the card as "Correct"
    const correctBtn = page.locator("button", { hasText: "Correct" });
    await correctBtn.click();

    // 7. Confirm completed screen transition
    await expect(page.locator("h2")).toContainText("Review Completed!");

    // Return to home desk
    await page.locator("button", { hasText: "Back to Study Desk" }).click();
    await expect(page).toHaveURL("/");
  });
});