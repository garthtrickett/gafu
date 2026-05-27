import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { login, signup, tokenState, userState } from "./authStore.ts";
import { LocationLive } from "../LocationService.ts";

describe("authStore", () => {
  beforeEach(() => {
    tokenState.value = null;
    userState.value = null;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("logins successfully and stores user state", async () => {
    const mockUser = {
      id: "test-id",
      email: "test@site.com",
      permissions: ["subscriber"],
      created_at: new Date().toISOString(),
      avatar_url: null,
      display_name: "Test User",
      is_guest: false,
      skills: []
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        token: "test-jwt-token",
        user: mockUser
      })
    });

    global.fetch = fetchMock as any;

    await Effect.runPromise(
      login("test@site.com", "password123").pipe(
        Effect.provide(LocationLive)
      )
    );

    expect(tokenState.value).toBe("test-jwt-token");
    expect(userState.value).toEqual(mockUser);
    expect(localStorage.getItem("jwt")).toBe("test-jwt-token");
  });

  it("handles signup successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: "new-user-id",
        email: "test@site.com"
      })
    });

    global.fetch = fetchMock as any;

    const run = signup("test@site.com", "password123");
    const result = await Effect.runPromise(
      run.pipe(Effect.provide(LocationLive))
    );

    expect(result).toEqual({
      id: "new-user-id",
      email: "test@site.com"
    });
  });
});
