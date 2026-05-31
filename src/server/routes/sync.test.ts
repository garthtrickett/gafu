import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Effect } from "effect";
import { app } from "../index.ts";
import { generateToken } from "../../lib/server/JwtService.ts";
import { db } from "../../db/client.ts";
import { packHlc, unpackHlc, initHlc } from "../../lib/shared/hlc.ts";
import type { PublicUser } from "../../lib/shared/schemas.ts";
import type { UserId } from "../../types/index.ts";

describe("Synchronization API Endpoint Suite", () => {
  let token: string;
  let testUser: PublicUser;

  beforeAll(async () => {
    testUser = {
      id: "77777777-7777-7777-7777-777777777777" as UserId,
      email: "tester@site.com",
      email_verified: true,
      permissions: [],
      created_at: new Date(),
      avatar_url: null,
      is_guest: false,
      display_name: "Tester",
      phone: null,
      skills: []
    };

    // Insert user to satisfy the foreign key constraint on user_preference
    await db.insertInto("user").values({
      id: testUser.id as UserId,
      email: testUser.email,
      password_hash: "mock_password_hash",
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();

    token = await Effect.runPromise(generateToken(testUser));
  });

  afterAll(async () => {
    await db.deleteFrom("user").where("id", "=", testUser.id as UserId).execute();
  });

  it("should abort pulls missing Authorization headers", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/sync/pull?since=0000000000000:0000:initial")
    );
    expect(response.status).toBe(401);
  });

  it("should allow pulling updates with a valid security token and HLC string", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/sync/pull?since=0000000000000:0000:initial", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { serverTimestamp: number; serverHlc: string; decks: unknown[] };
    expect(body).toHaveProperty("serverTimestamp");
    expect(body).toHaveProperty("serverHlc");
    expect(body).toHaveProperty("decks");
  });

  it("should allow pushing mock Outbox transactions stamped with HLC", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: "tx-12345",
          type: "toggle_skin",
          payload: { skinId: "dark-mode" },
          hlc: "1600000000000:0000:test-client"
        })
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe("Sync Push Route - Validation Boundaries", () => {
  it("should reject push requests with malformed non-UUID grammarPointId with a 400 Bad Request", async () => {
    const user: PublicUser = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      email: "learner@site.com",
      email_verified: true,
      permissions: ["study:session_start", "srs:update"],
      created_at: new Date(),
      avatar_url: null,
      is_guest: false,
      display_name: "Test Learner",
      phone: null,
      skills: []
    };

    const token = await Effect.runPromise(generateToken(user));

    const payload = {
      id: "1cba4d11-a963-438a-ab07-c18098d9426d",
      type: "record_review",
      payload: {
        grammarPointId: "tai",
        easeFactor: 2.5,
        repetitions: 0,
        intervalDays: 0,
        nextReview: new Date().toISOString()
      },
      hlc: "1600000000000:0000:test-client"
    };

    const response = await app.handle(
      new Request("http://127.0.0.1/api/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("Bad Request");
    expect(body.message).toContain("grammarPointId");
  });

  it("should reject push requests with negative values in update_preferences with a 400 Bad Request", async () => {
    const user: PublicUser = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      email: "learner@site.com",
      email_verified: true,
      permissions: ["study:session_start", "srs:update"],
      created_at: new Date(),
      avatar_url: null,
      is_guest: false,
      display_name: "Test Learner",
      phone: null,
      skills: []
    };

    const token = await Effect.runPromise(generateToken(user));

    const response = await app.handle(
      new Request("http://127.0.0.1/api/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: "tx-bad-neg",
          type: "update_preferences",
          payload: {
            dailyReviewLimit: 20,
            dailyNewRuleLimit: -5
          },
          hlc: "1600000000000:0000:test-client"
        })
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("Bad Request");
    expect(body.message).toContain("dailyNewRuleLimit");
  });

  it("should reject push requests with non-integer values in update_preferences with a 400 Bad Request", async () => {
    const user: PublicUser = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      email: "learner@site.com",
      email_verified: true,
      permissions: ["study:session_start", "srs:update"],
      created_at: new Date(),
      avatar_url: null,
      is_guest: false,
      display_name: "Test Learner",
      phone: null,
      skills: []
    };

    const token = await Effect.runPromise(generateToken(user));

    const response = await app.handle(
      new Request("http://127.0.0.1/api/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: "tx-bad-float",
          type: "update_preferences",
          payload: {
            dailyReviewLimit: 20.5,
            dailyNewRuleLimit: 3
          },
          hlc: "1600000000000:0000:test-client"
        })
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("Bad Request");
    expect(body.message).toContain("dailyReviewLimit");
  });
});

describe("HLC Synchronization Causal Order Integration", () => {
  let token: string;
  let testUser: PublicUser;

  beforeAll(async () => {
    testUser = {
      id: "88888888-8888-8888-8888-888888888888" as UserId,
      email: "hlc-tester@site.com",
      email_verified: true,
      permissions: [],
      created_at: new Date(),
      avatar_url: null,
      is_guest: false,
      display_name: "HLCTester",
      phone: null,
      skills: []
    };

    await db.insertInto("user").values({
      id: testUser.id as UserId,
      email: testUser.email,
      password_hash: "mock_hash_hlc",
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();

    token = await Effect.runPromise(generateToken(testUser));
  });

  afterAll(async () => {
    await db.deleteFrom("user").where("id", "=", testUser.id as UserId).execute();
  });

  it("should tick server clock forward when client pushes an ahead HLC, and return it in subsequent pulls", async () => {
    // 1. Generate an ahead HLC (2 hours in the future)
    const futureTime = Date.now() + 2 * 60 * 60 * 1000;
    const clientAheadHlc = packHlc({
      physical: futureTime,
      counter: 5,
      nodeId: "drifted-client"
    });

    // 2. Push a preference update stamped with the future HLC
    const pushResponse = await app.handle(
      new Request("http://localhost/api/sync/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: "tx-future-123",
          type: "update_preferences",
          payload: {
            dailyReviewLimit: 45,
            dailyNewRuleLimit: 8
          },
          hlc: clientAheadHlc
        })
      })
    );

    expect(pushResponse.status).toBe(200);

    // 3. Query user preference from database and verify the persisted HLC is ahead and bumped by 1
    const pref = await db.selectFrom("user_preference")
      .selectAll()
      .where("user_id", "=", testUser.id as UserId)
      .executeTakeFirstOrThrow();

    const unpackedPrefHlc = unpackHlc(pref.hlc);
    expect(unpackedPrefHlc.physical).toBe(futureTime);
    expect(unpackedPrefHlc.counter).toBe(6); // should be remote.counter + 1 = 6

    // 4. Execute a pull using a slightly older HLC than the clientAheadHlc
    const olderHlc = packHlc({
      physical: futureTime - 1000,
      counter: 0,
      nodeId: "other-node"
    });

    const pullResponse = await app.handle(
      new Request(`http://localhost/api/sync/pull?since=${olderHlc}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    );

    expect(pullResponse.status).toBe(200);
    const pullBody = (await pullResponse.json()) as { userPreference?: { dailyReviewLimit: number } };
    
    // Since pref.hlc is futureTime (which is > olderHlc), it must be returned in the pull payload
    expect(pullBody.userPreference).toBeDefined();
    expect(pullBody.userPreference?.dailyReviewLimit).toBe(45);
  });
});
