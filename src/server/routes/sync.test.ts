import { describe, it, expect, beforeAll } from "vitest";
import { Effect } from "effect";
import { app } from "../index.ts";
import { generateToken } from "../../lib/server/JwtService.ts";
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
    token = await Effect.runPromise(generateToken(testUser));
  });

  it("should abort pulls missing Authorization headers", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/sync/pull?since=0")
    );
    expect(response.status).toBe(401);
  });

  it("should allow pulling updates with a valid security token", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/sync/pull?since=0", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body).toHaveProperty("serverTimestamp");
    expect(body).toHaveProperty("decks");
    expect(body).toHaveProperty("srsUpdates");
  });

  it("should allow pushing mock Outbox transactions", async () => {
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
          timestamp: Date.now()
        })
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
  });
});
import { describe, it, expect } from "vitest";
import { app } from "../index";
import { generateToken } from "../../lib/server/JwtService";
import type { PublicUser } from "../../lib/shared/schemas";

describe("Sync Push Route - Non-UUID Protection", () => {
  it("should gracefully discard push requests with malformed non-UUID grammarPointId", async () => {
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

    const token = await generateToken(user);

    const payload = {
      id: "1cba4d11-a963-438a-ab07-c18098d9426d",
      type: "record_review",
      payload: {
        grammarPointId: "たい",
        easeFactor: 2.5,
        repetitions: 0,
        intervalDays: 0,
        nextReview: new Date().toISOString()
      },
      timestamp: Date.now()
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

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });
  });
});

