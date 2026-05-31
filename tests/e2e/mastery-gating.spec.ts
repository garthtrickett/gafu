import { test, expect } from "./utils/base-test";
import { createVerifiedSubscriber, cleanupTestUser } from "./utils/seed";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database, SrsCardId, UserId, GrammarPointId } from "../../src/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL,
});

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

test.describe("Mastery Gating, Cram Generation, and Preferences Bypass E2E Flow", () => {
  let testUser: { email: string; password: string; userId: UserId } | undefined;

  test.beforeAll(async () => {
    const connStr = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
    if (connStr) {
      process.env.DATABASE_URL = connStr;
    }

    const { seedDb } = await import("../../src/db/seed");
    const { serverRuntime } = await import("../../src/lib/server/server-runtime");

    console.warn("[E2E mastery-gating.spec.ts] Seeding test database...");
    await serverRuntime.runPromise(seedDb());
  });

  test.beforeEach(async () => {
    testUser = await createVerifiedSubscriber();

    const grammarPoints = [
      "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", // だ (N5)
      "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11", // は (N5)
      "11eebc99-9c0b-4ef8-bb6d-6bb9bd381b22", // も (N5)
      "22eebc99-9c0b-4ef8-bb6d-6bb9bd381c33", // に (N5)
      "33eebc99-9c0b-4ef8-bb6d-6bb9bd381d44", // で (N5)
    ];

    // Seed 5 active SRS cards where exactly 2 are mastered (repetitions >= 3 or interval_days >= 7)
    // This places the user's mastery rate at exactly 2/5 = 40% (under the 80% gate threshold)
    const pastDate = new Date(Date.now() - 3600000);
    const srsCards = [
      // gp-1: Mastered (repetitions = 3)
      {
        id: crypto.randomUUID() as SrsCardId,
        user_id: testUser.userId,
        grammar_point_id: grammarPoints[0] as GrammarPointId,
        ease_factor: 2.5,
        repetitions: 3,
        interval_days: 3,
        next_review: pastDate,
        created_at: new Date(),
        updated_at: new Date(),
        hlc: "0000000000000:0000:initial"
      },
      // gp-2: Mastered (interval_days = 7)
      {
        id: crypto.randomUUID() as SrsCardId,
        user_id: testUser.userId,
        grammar_point_id: grammarPoints[1] as GrammarPointId,
        ease_factor: 2.5,
        repetitions: 1,
        interval_days: 7,
        next_review: pastDate,
        created_at: new Date(),
        updated_at: new Date(),
        hlc: "0000000000000:0000:initial"
      },
      // gp-3: Unmastered
      {
        id: crypto.randomUUID() as SrsCardId,
        user_id: testUser.userId,
        grammar_point_id: grammarPoints[2] as GrammarPointId,
        ease_factor: 2.5,
        repetitions: 0,
        interval_days: 0,
        next_review: pastDate,
        created_at: new Date(),
        updated_at: new Date(),
        hlc: "0000000000000:0000:initial"
      },
      // gp-4: Unmastered
      {
        id: crypto.randomUUID() as SrsCardId,
        user_id: testUser.userId,
        grammar_point_id: grammarPoints[3] as GrammarPointId,
        ease_factor: 2.5,
        repetitions: 0,
        interval_days: 0,
        next_review: pastDate,
        created_at: new Date(),
        updated_at: new Date(),
        hlc: "0000000000000:0000:initial"
      },
      // gp-5: Unmastered
      {
        id: crypto.randomUUID() as SrsCardId,
        user_id: testUser.userId,
        grammar_point_id: grammarPoints[4] as GrammarPointId,
        ease_factor: 2.5,
        repetitions: 0,
        interval_days: 0,
        next_review: pastDate,
        created_at: new Date(),
        updated_at: new Date(),
        hlc: "0000000000000:0000:initial"
      },
    ];

    await db.insertInto("srs_card").values(srsCards).execute();

    // Seed default preferences with gates enforcement enabled
    await db.insertInto("user_preference").values({
      user_id: testUser.userId,
      daily_review_limit: 20,
      daily_new_rule_limit: 3,
      enforce_mastery_gates: true,
      created_at: new Date(),
      updated_at: new Date(),
      hlc: "0000000000000:0000:initial"
    }).execute();
  });

  test.afterEach(async () => {
    if (testUser) {
      await cleanupTestUser(testUser);
      await db.deleteFrom("srs_card").where("user_id", "=", testUser.userId).execute();
      await db.deleteFrom("user_preference").where("user_id", "=", testUser.userId).execute();
    }
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("should block progression when below 80% mastery, support cram exports, and unlock upon preference bypass toggle", async ({ page, context }) => {
    if (!testUser) {
      throw new Error("testUser is undefined");
    }

    // 1. Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // 2. Log in with seeded user credentials
    await page.goto("/login");
    await page.locator("#email").fill(testUser.email);
    await page.locator("#password").fill(testUser.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL("/");

    // 3. Confirm that the Mastery Gate alert is visible and indicates 40% mastery rate
    const gateAlert = page.locator("#mastery-gate-alert");
    await expect(gateAlert).toBeVisible();
    await expect(page.locator("#mastery-rate-pct")).toContainText("40%");

    // 4. Copy standard progress payload and assert that 0 new rules are introduced (queue remains exactly 5 due items)
    await page.locator("button", { hasText: "Copy Progress Payload" }).click();
    await expect(page.locator("button", { hasText: "Copied to Clipboard!" })).toBeVisible();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const payload = JSON.parse(clipboardText) as { queue: unknown[] };
    expect(payload.queue).toHaveLength(5);

    // 5. Verify the 'Compile Cram Payload' button is visible, click it, and assert the payload structure is specialized
    const cramBtn = page.locator("#btn-cram-export");
    await expect(cramBtn).toBeVisible();
    await cramBtn.click();
    await expect(cramBtn).toContainText("Cram Copied!");

    const cramClipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const cramPayload = JSON.parse(cramClipboardText) as { instructions: string; queue: unknown[] };
    expect(cramPayload.instructions).toContain("CRAM/REINFORCEMENT");
    expect(cramPayload.queue).toHaveLength(3); // Only the 3 unmastered active rules

    // 6. Disable Mastery Gate enforcement in configuration panel
    await page.locator("#enforce-gates-toggle").uncheck();

    // 7. Verify Mastery Gate Card disappears immediately
    await expect(gateAlert).not.toBeVisible();

    // 8. Copy standard payload again and assert that new rules are successfully introduced (total length exceeds 5)
    await page.locator("button", { hasText: "Copy Progress Payload" }).click();
    await expect(page.locator("button", { hasText: "Copied to Clipboard!" })).toBeVisible();

    const bypassedClipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const bypassedPayload = JSON.parse(bypassedClipboardText) as { queue: unknown[] };
    expect(bypassedPayload.queue.length).toBeGreaterThan(5);
  });
});
