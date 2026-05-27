import { Effect } from "effect";
import { html, type TemplateResult } from "lit-html";
import { clientLog } from "./clientLog.ts";
import { LocationService } from "./LocationService.ts";
import { runClientUnscoped } from "./runtime.ts";
import { login, signup, logout } from "./stores/authStore.ts";
import "../../components/StudySession.ts";
import "../../components/AiGenerator.ts";

const NotFoundView = (): ViewResult => ({
  template: html`
    <div class="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <h1 class="text-3xl font-bold mb-2">404</h1>
      <p class="text-zinc-400">Page Not Found</p>
    </div>
  `
});

export interface ViewResult {
  template: TemplateResult;
  cleanup?: () => void;
}

export interface Route {
  pattern: RegExp;
  view: (...args: string[]) => ViewResult;
  meta: {
    requiresAuth?: boolean;
    isPublicOnly?: boolean;
  };
}

type MatchedRoute = Route & { params: string[] };

const homeView = (): ViewResult => {
  return {
    template: html`
      <div class="max-w-4xl mx-auto space-y-6">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 class="text-2xl font-bold">Language Study Desk</h1>
            <p class="text-sm text-zinc-400">Review your active decks and vocabulary cycles.</p>
          </div>
          <button 
            @click=${logout}
            class="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded text-sm font-medium border border-zinc-800 transition-colors"
          >
            Logout
          </button>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
                    <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-4">
            <h2 class="text-lg font-semibold text-zinc-200">Conversational Japanese N5</h2>
            <p class="text-sm text-zinc-400">Essential survival phrases and foundational grammar structures.</p>
                        <div class="flex justify-between items-center text-xs text-zinc-500">
              <span>Active Reviews Ready</span>
              <span class="text-green-500 font-medium">Review active</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <button 
                @click=${() => runClientUnscoped(navigate("/study"))}
                class="py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-medium rounded text-sm transition-colors cursor-pointer"
              >
                Study Session
              </button>
              <button 
                @click=${() => runClientUnscoped(navigate("/generate"))}
                class="py-2 bg-green-650 hover:bg-green-600 text-white font-medium rounded text-sm transition-colors cursor-pointer border border-green-700"
              >
                AI Generator
              </button>
            </div>
          </div>

          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-4">
            <h2 class="text-lg font-semibold text-zinc-200">Study Progress</h2>
            <div class="space-y-2 text-sm text-zinc-400">
              <div class="flex justify-between">
                <span>Completed Reviews</span>
                <span class="text-zinc-200">0</span>
              </div>
              <div class="flex justify-between">
                <span>Learning Interval Accuracy</span>
                <span class="text-zinc-200">100%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  };
};

const loginView = (): ViewResult => {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    runClientUnscoped(
      login(email, password).pipe(
                Effect.catchAll((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          return clientLog("error", `[LoginView] Login operation failed: ${msg}`, { email, err });
        })
      )
    );
  };

  return {
    template: html`
      <div class="flex min-h-[60vh] items-center justify-center px-4">
        <div class="w-full max-w-md space-y-6 bg-zinc-950 border border-zinc-800 p-8 rounded-lg shadow-md">
          <div class="space-y-2 text-center">
            <h1 class="text-2xl font-bold tracking-tight text-white">Welcome Back</h1>
            <p class="text-sm text-zinc-400">Enter your credentials to access your language desk.</p>
          </div>
          
          <form @submit=${handleSubmit} class="space-y-4">
            <div class="space-y-1">
              <label for="email" class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Email Address</label>
              <input 
                id="email" 
                name="email" 
                type="email" 
                required 
                placeholder="you@example.com" 
                class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-zinc-600 text-sm"
              />
            </div>
            <div class="space-y-1">
              <label for="password" class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Password</label>
              <input 
                id="password" 
                name="password" 
                type="password" 
                required 
                placeholder="••••••••" 
                class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-zinc-600 text-sm"
              />
            </div>
            <button 
              type="submit" 
              class="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-medium rounded text-sm transition-colors"
            >
              Sign In
            </button>
          </form>

          <div class="text-center text-sm">
            <span class="text-zinc-400">Need an account?</span>
            <a href="/signup" class="font-medium text-zinc-250 hover:text-white transition-colors ml-1">Sign up</a>
          </div>
        </div>
      </div>
    `
  };
};

const signupView = (): ViewResult => {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

        runClientUnscoped(
      signup(email, password).pipe(
        Effect.catchAll((err: unknown) => {
          let msg = "Unknown signup error";
          if (err instanceof Error) {
            msg = err.message;
          } else if (err !== null && typeof err === "object" && "error" in err) {
            const errorObj = err;
            msg = String(errorObj.error);
          } else {
            msg = String(err);
          }
          return clientLog("error", `[SignupView] Signup operation failed: ${msg}`, { email, err });
        })
      )
    );
  };

  return {
    template: html`
      <div class="flex min-h-[60vh] items-center justify-center px-4">
        <div class="w-full max-w-md space-y-6 bg-zinc-950 border border-zinc-800 p-8 rounded-lg shadow-md">
          <div class="space-y-2 text-center">
            <h1 class="text-2xl font-bold tracking-tight text-white">Create Account</h1>
            <p class="text-sm text-zinc-400">Get started with offline-first learning.</p>
          </div>
          
          <form @submit=${handleSubmit} class="space-y-4">
            <div class="space-y-1">
              <label for="email" class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Email Address</label>
              <input 
                id="email" 
                name="email" 
                type="email" 
                required 
                placeholder="you@example.com" 
                class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-zinc-600 text-sm"
              />
            </div>
            <div class="space-y-1">
              <label for="password" class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Password</label>
              <input 
                id="password" 
                name="password" 
                type="password" 
                required 
                placeholder="••••••••" 
                class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-zinc-600 text-sm"
              />
            </div>
            <button 
              type="submit" 
              class="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-medium rounded text-sm transition-colors"
            >
              Sign Up
            </button>
          </form>

          <div class="text-center text-sm">
            <span class="text-zinc-400">Already registered?</span>
            <a href="/login" class="font-medium text-zinc-250 hover:text-white transition-colors ml-1">Log in</a>
          </div>
        </div>
      </div>
    `
  };
};

const studyView = (): ViewResult => {
  return {
    template: html`<study-session></study-session>`
  };
};

const generateView = (): ViewResult => {
  return {
    template: html`<ai-generator></ai-generator>`
  };
};

const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: homeView,
    meta: { requiresAuth: true },
  },
    {
    pattern: /^\/study$/,
    view: studyView,
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/generate$/,
    view: generateView,
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/login$/,
    view: loginView,
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/signup$/,
    view: signupView,
    meta: { isPublicOnly: true },
  }
];

export const matchRoute = (path: string): Effect.Effect<MatchedRoute, never, LocationService> =>
  Effect.gen(function* () {
    const cleanPath = path.split('?')[0] || "/";
    const { tokenState } = yield* Effect.promise(() => import("./stores/authStore.ts"));
    const isLoggedIn = tokenState.value !== null;

    let matched: Route | null = null;
    let params: string[] = [];

    for (const route of routes) {
      const match = cleanPath.match(route.pattern);
      if (match) {
        matched = route;
        params = match.slice(1).filter(Boolean);
        break;
      }
    }

    if (!matched) {
      return { pattern: /^\/404$/, view: NotFoundView, meta: {}, params: [] };
    }

    // Redirect to login if route requires authentication and user is not logged in
    if (matched.meta.requiresAuth && !isLoggedIn) {
      yield* clientLog("info", "[Router] Route requires authentication. Redirecting to /login.");
      const location = yield* LocationService;
      yield* location.navigate("/login");
      return {
        pattern: /^\/login$/,
        view: loginView,
        meta: { isPublicOnly: true },
        params: []
      };
    }

    // Redirect to home if route is public-only and user is logged in
    if (matched.meta.isPublicOnly && isLoggedIn) {
      yield* clientLog("info", "[Router] Route is public-only and user is authenticated. Redirecting to /.");
      const location = yield* LocationService;
      yield* location.navigate("/");
      return {
        pattern: /^\/$/,
        view: homeView,
        meta: { requiresAuth: true },
        params: []
      };
    }

    return { ...matched, params };
  });

export const navigate = (
  path: string,
): Effect.Effect<void, Error, LocationService> =>
  Effect.gen(function* () {
    yield* clientLog("info", `Navigating route path: ${path}`, undefined, "router");
    const location = yield* LocationService;
    yield* location.navigate(path);
  });
