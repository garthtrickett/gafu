import { test, expect } from "./utils/base-test";
import { createVerifiedSubscriber, cleanupTestUser } from "./utils/seed";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { unpackHlc } from "../../src/lib/shared/hlc";
import type { Database, UserId, GrammarPointId } from "../../src/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL,
});

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

test.describe("HLC Client Clock Drift Resiliency", () => {
  let testUser: { email: string; password: string; userId: UserId } | undefined;

  test.beforeAll(async () => {
    const connStr = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
    if (connStr) {
      process.env.DATABASE_URL = connStr;
    }

    const { seedDb } = await import("../../src/db/seed");
    const { serverRuntime } = await import("../../src/lib/server/server-runtime");
    await serverRuntime.runPromise(seedDb());
  });

  test.beforeEach(async () => {
    testUser = await createVerifiedSubscriber();
  });

  test.afterEach(async () => {
    if (testUser) {
      await cleanupTestUser(testUser);
      await db.deleteFrom("srs_card").where("user_id", "=", testUser.userId).execute();
    }
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("should causally process offline transactions and sync successfully when client clock runs 1 hour behind", async ({ page }) => {
    if (!testUser) {
      throw new Error("testUser is undefined");
    }

    const serverWallClock = Date.now();

    // 1. Simulate a client clock running exactly 1 hour behind the server
    await page.addInitScript(() => {
      const oneHourBehind = Date.now() - 60 * 60 * 1000;
      const drift = oneHourBehind - Date.now();
      const originalNow = Date.now;
      Date.now = () => originalNow() + drift;
    });

    // 2. Log in with the test user
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL("/");

    // 3. Inject a valid study session payload to review the seeded 'だ' grammar point
    const mockSessionPayload = {
      session_id: "test-session-drift-123",
      cards: [
        {
          grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", // Seeded 'だ'
          english_context: "E2E Clock Drift Test Context.",
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
    await textarea.fill(JSON.stringify(mockSessionPayload));

    // 4. Start the study and grade the card as correct
    await page.locator("button", { hasText: "Import & Start Study" }).click();
    await expect(page).toHaveURL("/study");

    // Click "Correct"
    await page.getByRole("button", { name: "Correct", exact: true }).click();
    await expect(page.locator("h2")).toContainText("Review Completed!");

    // Return to home to ensure outbox flush starts/completes
    await page.locator("button", { hasText: "Back to Study Desk" }).click();
    await expect(page).toHaveURL("/");

    // 5. Wait a short moment for background service to flush the transaction queue
    await page.waitForTimeout(2000);

    // 6. Verify directly in the database that the transaction has been causally processed
    const srsRecord = await db.selectFrom("srs_card")
      .selectAll()
      .where("user_id", "=", testUser.userId)
      .where("grammar_point_id", "=", "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55" as GrammarPointId)
      .executeTakeFirst();

    expect(srsRecord).toBeDefined();
    
    // Unpack HLC and assert server wall clock was used (since local client HLC was in the past)
    const unpackedHlc = unpackHlc(srsRecord!.hlc);
    
    // Server physical timestamp should be near the server wall clock (within 30 seconds),
    // not 1 hour in the past!
    expect(Math.abs(unpackedHlc.physical - serverWallClock)).toBeLessThan(30000);
  });
});
