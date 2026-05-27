import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { login, signup, tokenState, userState } from "./authStore.ts";

describe("Authentication Client Store Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenState.value = null;
    userState.value = null;
    localStorage.clear();
  });

  it("should process login requests and persist session token", async () => {
    const mockToken = "mock-jwt-token";
    const mockUser = { id: "user-1", email: "test@site.com", permissions: [] };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: mockToken, user: mockUser })
    });
    global.fetch = fetchMock;

    await Effect.runPromise(login("test@site.com", "password123"));

    expect(tokenState.value).toBe(mockToken);
    expect(userState.value).toEqual(mockUser);
    expect(localStorage.getItem("jwt")).toBe(mockToken);
  });

  it("should abort login operations upon receiving server errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Invalid credentials" })
    });
    global.fetch = fetchMock;

    const run = login("bad@site.com", "password123").pipe(Effect.either);
    const result = await Effect.runPromise(run);

    expect(result._tag).toBe("Left");
    expect(tokenState.value).toBeNull();
  });
});
