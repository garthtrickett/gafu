import { Effect } from "effect";
import { runClientUnscoped } from "./lib/client/runtime.ts";
import { clientLog } from "./lib/client/clientLog.ts";
import { deckStore } from "./lib/client/stores/deckStore.ts";
import { srsStore } from "./lib/client/stores/srsStore.ts";
import { grammarPointStore, grammarPointCatalogStore } from "./lib/client/stores/grammarPointStore.ts";
import { startOutboxService } from "./lib/client/sync/OutboxQueue.ts";
import { startDeltaPullEngine } from "./lib/client/sync/DeltaPullEngine.ts";
import { startMediaPrewarmEngine } from "./lib/client/media/MediaPrewarmService.ts";
import { initPWA } from "./lib/client/stores/pwaStore.ts";

// Register custom elements
import "./components/layouts/app-shell.ts";

const bootstrapApp = Effect.gen(function* () {
  yield* clientLog("info", "[Main] Initiating application bootstrap sequence...");

  // Hydrate local data storage collections from IndexedDB
  yield* clientLog("info", "[Main] Hydrating local deck storage from IndexedDB...");
  yield* deckStore.load();

  yield* clientLog("info", "[Main] Hydrating SRS card metadata storage from IndexedDB...");
  yield* srsStore.load();

  yield* clientLog("info", "[Main] Hydrating Grammar Point progress storage from IndexedDB...");
  yield* grammarPointStore.load();

    yield* clientLog("info", "[Main] Hydrating Grammar Point global catalog storage from IndexedDB...");
  yield* grammarPointCatalogStore.load();

  yield* clientLog("info", "[Main] Hydrating User Preferences storage from IndexedDB...");
  const { userPreferencesStore } = yield* Effect.promise(() => import("./lib/client/stores/userPreferencesStore.ts"));
  yield* userPreferencesStore.load();

  // Attempt session restoration
  const { initAuth } = yield* Effect.promise(() => import("./lib/client/stores/authStore.ts"));
  yield* initAuth();

  // Initialize PWA installation events
  yield* Effect.sync(() => {
    clientLog("info", "[Main] Registering PWA installation listeners...");
    initPWA();
  });

  // Start the background system daemons
  yield* Effect.sync(() => {
    clientLog("info", "[Main] Launching synchronization and prewarm services...");
    startOutboxService();
    startDeltaPullEngine();
    startMediaPrewarmEngine();
  });

  yield* clientLog("info", "[Main] Application successfully bootstrapped and background services active.");
}).pipe(
  Effect.catchAll((err) =>
    clientLog("error", "[Main] Catastrophic failure occurred during the application boot process", err)
  )
);

// Run the bootstrap sequence within the client effect runtime
runClientUnscoped(bootstrapApp);
