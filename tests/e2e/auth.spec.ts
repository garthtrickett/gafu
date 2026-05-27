import { test, expect } from "./utils/base-test";

test.describe("Authentication and Onboarding Flow", () => {
  test("should allow a new user to sign up and then log in", async ({ page }) => {
    const email = `test-user-${Date.now()}@test.com`;
    const password = "Password123!";

    // 1. Navigate to the registration route
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/signup/);

    // 2. Submit the registration credentials
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();

    // 3. Confirm redirection to the login route
    await expect(page).toHaveURL(/\/login/);

    // 4. Fill in credentials on the login screen and authenticate
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();

    // 5. Verify successful navigation to the target home dashboard route
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Language Study Desk");

    // 6. Confirm the core interactive elements are rendered
    await expect(page.locator("button", { hasText: "Start Study Session" })).toBeVisible();
  });
});
