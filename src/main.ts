import { Effect } from "effect";
import { runClientUnscoped } from "./lib/client/runtime.ts";
import { clientLog } from "./lib/client/clientLog.ts";
import { runClientMigrations } from "./lib/client/storage/ClientMigrationCoordinator.ts";
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

  // 1. Run local-first client database schema migrations upfront as a secure boot barrier
  yield* runClientMigrations();

  // 2. Hydrate local HLC state to ensure clock validity during early mutations
  yield* clientLog("info", "[Main] Hydrating local HLC state from IndexedDB...");
  const { hlcStore } = yield* Effect.promise(() => import("./lib/client/stores/hlcStore.ts"));
  yield* hlcStore.load();
  yield* clientLog("debug", `[Main] HLC state hydrated: hlc=${hlcStore.getPacked()}`);

  // 3. Hydrate local data storage collections from IndexedDB
  yield* clientLog("info", "[Main] Hydrating local deck storage from IndexedDB...");
  yield* deckStore.load();
  yield* clientLog("debug", `[Main] Decks hydrated: count=${deckStore.state.value.length}`);

  yield* clientLog("info", "[Main] Hydrating SRS card metadata storage from IndexedDB...");
  yield* srsStore.load();
  yield* clientLog("debug", `[Main] SRS cards hydrated: count=${srsStore.state.value.length}`);

  yield* clientLog("info", "[Main] Hydrating Grammar Point progress storage from IndexedDB...");
  yield* grammarPointStore.load();
  yield* clientLog("debug", `[Main] Grammar points progress hydrated: count=${grammarPointStore.state.value.length}`);

  yield* clientLog("info", "[Main] Hydrating Grammar Point global catalog storage from IndexedDB...");
  yield* grammarPointCatalogStore.load();
  yield* clientLog("debug", `[Main] Grammar points catalog hydrated: count=${grammarPointCatalogStore.state.value.length}`);

    yield* clientLog("info", "[Main] Hydrating User Preferences storage from IndexedDB...");
  const { userPreferencesStore } = yield* Effect.promise(() => import("./lib/client/stores/userPreferencesStore.ts"));
  yield* userPreferencesStore.load();
  yield* clientLog("debug", `[Main] User preferences hydrated: reviewLimit=${userPreferencesStore.dailyReviewLimit.value}`);

  yield* clientLog("info", "[Main] Hydrating Active Session state from IndexedDB...");
  const { activeSessionStore } = yield* Effect.promise(() => import("./lib/client/stores/activeSessionStore.ts"));
  yield* activeSessionStore.load();
  yield* clientLog("debug", `[Main] Active session hydrated: masterListCount=${activeSessionStore.masterList.value.length}`);

  // 4. Attempt session restoration
  const { initAuth } = yield* Effect.promise(() => import("./lib/client/stores/authStore.ts"));
  yield* clientLog("info", "[Main] Attempting session restoration...");
  yield* initAuth();

  // 5. Initialize PWA installation events
  yield* Effect.sync(() => {
    clientLog("info", "[Main] Registering PWA installation listeners...");
    initPWA();
  });

  // 6. Start the background system daemons
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
