import { signal } from "@preact/signals-core";
import { Workbox } from "workbox-window";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

let wbInstance: Workbox | null = null;

export const installPromptState =
  signal<BeforeInstallPromptEvent | null>(null);
export const isAppInstalledState = signal<boolean>(false);
export const isUpdateAvailableState = signal<boolean>(false);

const shouldRegisterServiceWorker = (): boolean =>
  import.meta.env.PROD ||
  import.meta.env.VITE_PWA_DEV === "true";

const serviceWorkerUrl = (): string =>
  import.meta.env.PROD ? "/sw.js" : "/dev-sw.js?dev-sw";

export const handleServiceWorkerControlling = (
  hadControllerAtRegistration: boolean,
  reloadPage: () => void = () => window.location.reload(),
) => {
  if (!hadControllerAtRegistration) {
    runClientUnscoped(
      clientLog(
        "info",
        "[PWA] Initial service worker control acquired. Continuing without a page reload.",
      ),
    );
    return;
  }

  isUpdateAvailableState.value = false;
  runClientUnscoped(
    clientLog(
      "info",
      "[PWA] Updated service worker has taken control. Reloading the page once.",
    ),
  );
  reloadPage();
};

export const initPWA = () => {
  if (typeof window === "undefined") return;

  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  ) {
    isAppInstalledState.value = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    runClientUnscoped(
      clientLog("info", "[PWA] Installation trigger captured"),
    );
    installPromptState.value =
      event as BeforeInstallPromptEvent;
  });

  window.addEventListener("appinstalled", () => {
    runClientUnscoped(
      clientLog(
        "info",
        "[PWA] Application successfully installed",
      ),
    );
    installPromptState.value = null;
    isAppInstalledState.value = true;
  });

  if (
    !("serviceWorker" in navigator) ||
    !shouldRegisterServiceWorker()
  ) {
    runClientUnscoped(
      clientLog(
        "debug",
        "[PWA] Service worker registration is disabled for this environment.",
      ),
    );
    return;
  }

  const workerUrl = serviceWorkerUrl();
  const workerType = import.meta.env.PROD
    ? "classic"
    : "module";
  const hadControllerAtRegistration =
    navigator.serviceWorker.controller !== null;

  runClientUnscoped(
    clientLog(
      "info",
      `[PWA] Registering service worker url=${workerUrl} type=${workerType}.`,
    ),
  );

  wbInstance = new Workbox(workerUrl, {
    type: workerType,
  });

  wbInstance.addEventListener("waiting", () => {
    runClientUnscoped(
      clientLog(
        "info",
        "[PWA] New service worker is waiting. Update available!",
      ),
    );
    isUpdateAvailableState.value = true;
  });

  wbInstance.addEventListener("controlling", () => {
    handleServiceWorkerControlling(
      hadControllerAtRegistration,
    );
  });

  wbInstance.register().catch((error: unknown) => {
    runClientUnscoped(
      clientLog(
        "error",
        "[PWA] Service worker registration failed",
        error,
      ),
    );
  });
};

export const promptInstall = async () => {
  const promptEvent = installPromptState.value;
  if (!promptEvent) return;

  await promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  runClientUnscoped(
    clientLog("info", `[PWA] Installation outcome: ${outcome}`),
  );
  installPromptState.value = null;
};

export const applyAppUpdate = () => {
  if (wbInstance) {
    runClientUnscoped(
      clientLog(
        "info",
        "[PWA] Requesting waiting service worker to skip waiting...",
      ),
    );
    wbInstance.messageSkipWaiting();
  }
};
