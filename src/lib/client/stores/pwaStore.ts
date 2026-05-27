import { signal } from "@preact/signals-core";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const installPromptState = signal<BeforeInstallPromptEvent | null>(null);
export const isAppInstalledState = signal<boolean>(false);

export const initPWA = () => {
  if (window.matchMedia("(display-mode: standalone)").matches) {
    isAppInstalledState.value = true;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    runClientUnscoped(clientLog("info", "[PWA] Installation trigger captured"));
    installPromptState.value = e as BeforeInstallPromptEvent;
  });

  window.addEventListener("appinstalled", () => {
    runClientUnscoped(clientLog("info", "[PWA] Application successfully installed"));
    installPromptState.value = null;
    isAppInstalledState.value = true;
  });
};

export const promptInstall = async () => {
  const promptEvent = installPromptState.value;
  if (!promptEvent) return;

  await promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  runClientUnscoped(clientLog("info", `[PWA] Installation outcome: ${outcome}`));
  installPromptState.value = null;
};
