import { Effect } from "effect";
import { html, type TemplateResult } from "lit-html";
import { clientLog } from "./clientLog.ts";
import { LocationService } from "./LocationService.ts";
import { runClientUnscoped } from "./runtime.ts";
import { login, signup, logout } from "./stores/authStore.ts";
import { generateExportPayload, importSessionPayload } from "./stores/sessionSyncStore.ts";
import { activeSessionStore } from "./stores/activeSessionStore.ts";
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
  let selectedTheme = "daily";
  let pasteValue = "";
  let importError: string | null = null;

  const triggerExport = (e: Event) => {
    const btn = e.target as HTMLButtonElement;
    const originalText = btn.textContent || "";
    btn.textContent = "⏱️ Compiling...";
    btn.disabled = true;

    runClientUnscoped(
      generateExportPayload(selectedTheme).pipe(
        Effect.andThen(() => Effect.sync(() => {
          btn.textContent = "✅ Copied to Clipboard!";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);
        })),
        Effect.catchAll((err) => {
          btn.textContent = "❌ Failed to Copy";
          btn.disabled = false;
          return clientLog("error", "Export failed", err);
        })
      )
    );
  };

  const handleImport = (e: Event) => {
    e.preventDefault();
    importError = null;

    if (!pasteValue.trim()) {
      importError = "Please paste a valid session JSON payload.";
      window.dispatchEvent(new CustomEvent("location-changed"));
      return;
    }

    runClientUnscoped(
      importSessionPayload(pasteValue).pipe(
        Effect.andThen(() => navigate("/study")),
        Effect.catchAll((err) => {
          importError = err instanceof Error ? err.message : String(err);
          window.dispatchEvent(new CustomEvent("location-changed"));
          return clientLog("error", "Import failed", err);
        })
      )
    );
  };

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
            class="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded text-sm font-medium border border-zinc-800 transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <!-- Setup Wizard Deck Card (Manual Handshake Compiler) -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-5">
            <div>
              <h2 class="text-lg font-semibold text-zinc-200">Conversational Japanese N5</h2>
              <p class="text-sm text-zinc-400 mt-1">Essential survival phrases and foundational grammar.</p>
            </div>

            <div class="space-y-4 pt-2 border-t border-zinc-900">
              <div class="space-y-1.5">
                <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Vocabulary Theme</label>
                <select 
                  @change=${(e: Event) => { selectedTheme = (e.target as HTMLSelectElement).value; }}
                  class="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 text-sm focus:outline-none focus:border-zinc-700"
                >
                  <option value="daily">Daily Life Theme</option>
                  <option value="anime">Anime Theme</option>
                  <option value="business">Business Theme</option>
                  <option value="travel">Travel Theme</option>
                </select>
              </div>

              <div class="space-y-2">
                <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">1. Export Progress</span>
                <button 
                  @click=${triggerExport}
                  class="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-100 hover:text-white font-medium rounded text-sm transition-colors cursor-pointer border border-zinc-800 flex items-center justify-center gap-2"
                >
                  📋 Copy Progress Payload
                </button>
                <p class="text-2xs text-zinc-500">Copies your due N5 progress rules so the AI can compile matching cards.</p>
              </div>

              <form @submit=${handleImport} class="space-y-2 pt-2 border-t border-zinc-900">
                <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">2. Import Session</span>
                <textarea
                  @input=${(e: Event) => { pasteValue = (e.target as HTMLTextAreaElement).value; }}
                  placeholder="Paste the compiled JSON session payload here..."
                  class="w-full h-24 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 text-xs font-mono"
                ></textarea>
                
                ${importError ? html`<p class="text-xs text-red-400 font-medium">${importError}</p>` : ""}

                <button 
                  type="submit"
                  class="w-full py-2.5 bg-green-650 hover:bg-green-600 text-white font-bold rounded text-sm transition-colors cursor-pointer"
                >
                  🚀 Import & Start Study
                </button>
              </form>
            </div>
          </div>

          <!-- Study Progress / Stats Card -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <h2 class="text-lg font-semibold text-zinc-200">Study Progress</h2>
              <div class="space-y-3 text-sm text-zinc-400 mt-4">
                <div class="flex justify-between border-b border-zinc-900 pb-2">
                  <span>Total Studied Rules</span>
                  <span class="text-zinc-200 font-semibold">N5 Catalog Active</span>
                </div>
                <div class="flex justify-between border-b border-zinc-900 pb-2">
                  <span>Sync Outbox Queue</span>
                  <span class="text-zinc-200">Local-first enabled</span>
                </div>
              </div>
            </div>
            <div class="p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg text-xs text-zinc-400 leading-relaxed">
              💡 <strong>Handshake Flow</strong>: Click "Copy Progress", paste it to your language tutor bot to generate your daily review cards, then paste the returned JSON back here to review with zero latency.
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
