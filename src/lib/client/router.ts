import { Effect } from "effect";
import { html, type TemplateResult } from "lit-html";
import { clientLog } from "./clientLog";
import { LocationService } from "./LocationService";

const NotFoundView = (): ViewResult => ({ template: html`<div>404 Page Not Found</div>` });

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

const routes: Route[] = [
  {
    pattern: /^\/$/,
    view: () => ({ template: html`<div>Lesson Deck Space (Home)</div>` }),
    meta: { requiresAuth: true },
  },
  {
    pattern: /^\/login$/,
    view: () => ({ template: html`<div>Login Interface</div>` }),
    meta: { isPublicOnly: true },
  },
  {
    pattern: /^\/signup$/,
    view: () => ({ template: html`<div>Signup Interface</div>` }),
    meta: { isPublicOnly: true },
  }
];

export const matchRoute = (path: string): Effect.Effect<MatchedRoute> =>
  Effect.gen(function* () {
    const cleanPath = path.split('?')[0] || "/";
    for (const route of routes) {
      const match = cleanPath.match(route.pattern);
      if (match) {
        return { ...route, params: match.slice(1).filter(Boolean) };
      }
    }
    return { pattern: /^\/404$/, view: NotFoundView, meta: {}, params: [] };
  });

export const navigate = (
  path: string,
): Effect.Effect<void, Error, LocationService> =>
  Effect.gen(function* () {
    yield* clientLog("info", `Navigating route path: ${path}`, undefined, "router");
    const location = yield* LocationService;
    yield* location.navigate(path);
  });
