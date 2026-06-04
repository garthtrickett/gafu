import { test, expect } from "./utils/base-test";
import { createVerifiedSubscriber, cleanupTestUser } from "./utils/seed";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database, SrsCardId, UserId } from "../../src/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL,
});

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

test.describe("SRS Pacing, Daily Cap, and Mastery Gating E2E Flow", () => {
  let testUser: { email: string; password: string; userId: UserId } | undefined;

  test.beforeAll(async () => {
    const connStr = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
    console.warn(`[E2E srs.spec.ts] E2E Resolved Database Connection String: ${connStr ? connStr.replace(/:([^@]+)@/, ":****@") : "undefined"}`);
    if (connStr) {
      process.env.DATABASE_URL = connStr;
    }

    const { seedDb } = await import("../../src/db/seed");
    const { serverRuntime } = await import("../../src/lib/server/server-runtime");

    console.warn("[E2E srs.spec.ts] Seeding test database with baseline catalog/metrics...");
    await serverRuntime.runPromise(seedDb());
    console.warn("[E2E srs.spec.ts] Test database seeding complete.");
  });

    test.beforeEach(async () => {
    testUser = await createVerifiedSubscriber();
    // Seed default testing preferences to match original test assertions
    await db.insertInto("user_preference").values({
      user_id: testUser.userId,
      daily_review_limit: 20,
      daily_new_rule_limit: 3,
      enforce_mastery_gates: false,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();
  });

  test.afterEach(async () => {
    if (testUser) {
      await cleanupTestUser(testUser);
      // Clean up any SRS cards generated during the test to keep E2E database clean
      await db.deleteFrom("srs_card").where("user_id", "=", testUser.userId).execute();
    }
  });

  test.afterAll(async () => {
    const { closeDb } = await import("../../src/db/client");
    console.warn("[E2E srs.spec.ts] Closing server database client connection pool...");
    await closeDb();
    console.warn("[E2E srs.spec.ts] Closing spec-file database client connection pool...");
    await pool.end();
  });

    test("should enforce lock-step daily pacing and caps during study desk operations", async ({ page, context }) => {
    if (!testUser) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      throw new Error("testUser is undefined");
    }

    // 1. Authenticate the test user
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    // Confirm redirection to target home dashboard route
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Language Study Desk");

    // 2. Initial state: Active queue is empty, but Fallback values are displayed on empty store
    await page.locator("button", { hasText: "View Active Queue" }).click();
    await expect(page.locator("text=Due Today - Daily Target (11 rules)")).toBeVisible();

    // 3. Export Progress payload: This initiates first-time pacing
    // Click Copy Progress Payload button to compile progress
    await page.locator("button", { hasText: "Copy Progress Payload" }).click();
    await expect(page.locator("button", { hasText: "Copied to Clipboard!" })).toBeVisible();

    // The system should reactively transition from fallback lists to active, paced learning rules
    // (exactly 3 rules unlocked: だ, は, も) because the local progress was empty and daily cap is 3
    await expect(page.locator("text=Due Today - Daily Target (3 rules)")).toBeVisible();
    await expect(page.locator(".divide-y span", { hasText: "だ" })).toBeVisible();
    expect(await page.locator("div.py-2").count()).toBe(3);

    // 4. Rate-Limiting: Exporting again immediately should yield 0 new rules (daily cap is exhausted)
    // Click Copy Progress Payload again to compile progress
    await page.locator("button", { hasText: "Copy Progress Payload" }).click();
    await expect(page.locator("button", { hasText: "Copied to Clipboard!" })).toBeVisible();

    // The count of active due target rules should remain exactly 3
    await expect(page.locator("text=Due Today - Daily Target (3 rules)")).toBeVisible();
  });

  test("should enforce the 20-card review cap and partition excess due rules into the snoozed backlog", async ({ page }) => {
    if (!testUser) {
      throw new Error("testUser is undefined");
    }
    const currentUser = testUser;

    // 1. Retrieve N5 abstract grammar points to mock the user's progress records
    const grammarPoints = await db
      .selectFrom("grammar_point")
      .select("id")
      .limit(30)
      .execute();

    expect(grammarPoints.length).toBeGreaterThanOrEqual(25);

        // 2. Pre-seed the database with 30 due srs_card records for this user (all due in the past)
    const pastDate = new Date(Date.now() - 3600000); // 1h in past
    const srsCards = grammarPoints.map((gp) => ({
      id: crypto.randomUUID() as SrsCardId,
      user_id: currentUser.userId,
      grammar_point_id: gp.id,
      ease_factor: 2.5,
      repetitions: 1,
      interval_days: 1,
      difficulty: 5.0,
      stability: 24.0,
      last_reviewed_at: pastDate,
      next_review: pastDate,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    await db.insertInto("srs_card").values(srsCards).execute();

    // 3. Log in with the pre-seeded user
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    // Confirm redirection to target home dashboard route
    await expect(page).toHaveURL("/");

    // 4. View active queue
    await page.locator("button", { hasText: "View Active Queue" }).click();

    // 5. Verify the 30 due items are split: 20 in Due Today target and 10 in Snoozed Backlog
    await expect(page.locator("text=Due Today - Daily Target (20 rules)")).toBeVisible();
    await expect(page.locator("text=Snoozed Backlog (10 rules)")).toBeVisible();
  });

  test("should dynamically expand active queue and shrink backlog when preferences are updated", async ({ page }) => {
    if (!testUser) {
      throw new Error("testUser is undefined");
    }
    const currentUser = testUser;

    // 1. Retrieve N5 grammar points to mock the progress records
    const grammarPoints = await db
      .selectFrom("grammar_point")
      .select("id")
      .limit(30)
      .execute();

    expect(grammarPoints.length).toBeGreaterThanOrEqual(25);

        // 2. Pre-seed the database with 30 due srs_card records for this user (all due in the past)
    const pastDate = new Date(Date.now() - 3600000);
    const srsCards = grammarPoints.map((gp) => ({
      id: crypto.randomUUID() as SrsCardId,
      user_id: currentUser.userId,
      grammar_point_id: gp.id,
      ease_factor: 2.5,
      repetitions: 1,
      interval_days: 1,
      difficulty: 5.0,
      stability: 24.0,
      last_reviewed_at: pastDate,
      next_review: pastDate,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    await db.deleteFrom("srs_card").where("user_id", "=", currentUser.userId).execute();
    await db.insertInto("srs_card").values(srsCards).execute();

    // 3. Log in
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL("/");

    // 4. Open active queue to see initial partition (20 target, 10 backlog)
    await page.locator("button", { hasText: "View Active Queue" }).click();
    await expect(page.locator("text=Due Today - Daily Target (20 rules)")).toBeVisible();
    await expect(page.locator("text=Snoozed Backlog (10 rules)")).toBeVisible();

    // 5. Update preferred review limit to 50 via UI input field
    const reviewInput = page.locator("input[type='number']").first();
    await reviewInput.click();
    await reviewInput.fill("50");
    await reviewInput.press("Enter");

        // 6. Verify the lists dynamically expand and adjust: all 30 should now be inside target, backlog should disappear
    await expect(page.locator("text=Due Today - Daily Target (30 rules)")).toBeVisible();
    await expect(page.locator("text=Snoozed Backlog")).not.toBeVisible();
  });

  test("should update memory retention and deck difficulty metrics reactively after completing a study session", async ({ page, context }) => {
    if (!testUser) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      throw new Error("testUser is undefined");
    }

    // 1. Authenticate the test user
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL("/");

    // 2. Initial state metrics check: Since the user starts fresh, we should see 100% retention and 5.0 difficulty fallbacks
    await expect(page.locator("#retention-rate")).toContainText("100%");
    await expect(page.locator("#avg-difficulty")).toContainText("5.0");

    // 3. Inject and complete a study session with a card
    const mockPayload = {
      session_id: "test-metrics-session",
      cards: [
        {
          grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", 
          english_context: "E2E Testing metrics reactive update.",
          japanese_sentence: "これはテストです。",
          furigana: [
            { kanji: "これ" },
            { kanji: "は" },
            { kanji: "テスト" },
            { kanji: "です" }
          ],
          audio_url: null,
          hlc: "0000000000000:0000:initial"
        }
      ]
    };

    const textarea = page.locator("textarea");
    await textarea.fill(JSON.stringify(mockPayload));
    await page.locator("button", { hasText: "Import & Start Study" }).click();

    // Confirm transition to the active study session view
    await expect(page).toHaveURL("/study");

    // Grade the card as Correct (difficulty: 4.5, stability: 1.0, repetitions: 1)
    await page.getByRole("button", { name: "Correct", exact: true }).click();
    await expect(page.locator("h2")).toContainText("Review Completed!");

    // Return to study desk
    await page.locator("button", { hasText: "Back to Study Desk" }).click();
    await expect(page).toHaveURL("/");

    // 4. Verify metrics updated on the main page:
    await expect(page.locator("#avg-difficulty")).toContainText("4.5");
    await expect(page.locator("#count-learning")).toContainText("1");
  });
});
