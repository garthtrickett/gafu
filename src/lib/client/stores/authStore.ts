import { signal, computed } from "@preact/signals-core";
import { Effect } from "effect";
import { clientLog } from "../clientLog.ts";
import { runClientPromise } from "../runtime.ts";

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly display_name?: string | null;
  readonly avatar_url?: string | null;
  readonly permissions: string[];
}

const getSanitizedToken = (): string | null => {
  if (typeof localStorage === "undefined") return null;
  const t = localStorage.getItem("jwt");
  if (!t || t === "null" || t === "undefined" || t.trim() === "") return null;
  return t;
};

export const tokenState = signal<string | null>(getSanitizedToken());

export const userState = signal<UserProfile | null>(null);

export const isAuthenticated = computed(() => tokenState.value !== null);

export const initAuth = () =>
  Effect.gen(function* () {
    const token = tokenState.value;
    yield* clientLog("debug", `[AuthStore:initAuth] Initializing authentication. Raw token state: "${token}"`);
    if (!token) {
      yield* clientLog("info", "[AuthStore:initAuth] No valid token found during session initialization.");
      return;
    }

    yield* clientLog("info", "[AuthStore] Restoring session from storage...");

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      catch: (e) => new Error(`Authorization check failed: ${String(e)}`),
    });

        if (response.ok) {
      const data = (yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ user: UserProfile }>,
        catch: (e) => e,
      }));
      userState.value = data.user;
      yield* clientLog("info", `[AuthStore] Session recovered successfully: ${data.user.email}`);
    } else {
      yield* clientLog("warn", `[AuthStore] Restored token is expired or invalid (HTTP ${response.status}). Purging cache.`);
      logout();
    }
  });

export const login = (email: string, password: string) =>
  Effect.gen(function* () {
    yield* clientLog("info", `[AuthStore] Dispatching login request: ${email}`);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      catch: (e) => new Error(`Auth request connection failed: ${String(e)}`),
    });

    if (!response.ok) {
      const errorResponse = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Unknown network error" }),
      });
      return yield* Effect.fail(new Error(errorResponse.error));
    }

    const data = (yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ token: string; user: UserProfile }>,
      catch: (e) => e,
    }));

    tokenState.value = data.token;
    userState.value = data.user;
    localStorage.setItem("jwt", data.token);

    yield* clientLog("info", `[AuthStore] Session authenticated: ${data.user.email}`);

    const { navigate } = yield* import("../router.ts");
    yield* navigate("/");
  });

export const signup = (email: string, password: string) =>
  Effect.gen(function* () {
    yield* clientLog("info", `[AuthStore] Dispatching signup request: ${email}`);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      catch: (e) => new Error(`Signup connection failed: ${String(e)}`),
    });

    if (!response.ok) {
      const errorResponse = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Signup process failed" }),
      });
      return yield* Effect.fail(new Error(errorResponse.error));
    }

    yield* clientLog("info", "[AuthStore] Account created. Redirecting to sign in...");
    const { navigate } = yield* import("../router.ts");
    yield* navigate("/login");
  });

export const logout = () => {
  tokenState.value = null;
  userState.value = null;
  localStorage.removeItem("jwt");
  void runClientPromise(clientLog("info", "[AuthStore] Session terminated. Navigating to login."));

  void import("../router.ts").then(({ navigate }) => {
    void runClientPromise(navigate("/login"));
  });
};
