import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isUpdateAvailableState, initPWA, applyAppUpdate } from "./pwaStore";

const mockRegister = vi.fn().mockResolvedValue({});
const mockAddEventListener = vi.fn();
const mockMessageSkipWaiting = vi.fn().mockResolvedValue({});

class MockWorkbox {
  register = mockRegister;
  addEventListener = mockAddEventListener;
  messageSkipWaiting = mockMessageSkipWaiting;
}

vi.mock("workbox-window", () => ({
  Workbox: vi.fn().mockImplementation(() => new MockWorkbox())
}));

describe("pwaStore - PWA and Service Worker Update Lifecycle", () => {
  let originalProd: boolean;

  beforeEach(() => {
    vi.clearAllMocks();

        // Stub serviceWorker support on jsdom navigator
    Object.defineProperty(global.navigator, "serviceWorker", {
      value: {
        register: vi.fn()
      },
      configurable: true,
      writable: true
    });

    // Stub matchMedia support in jsdom
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // Stub production environment setting for local PWA registration check
    originalProd = import.meta.env.PROD;
    // @ts-ignore
    import.meta.env.PROD = true;

    isUpdateAvailableState.value = false;
  });

  afterEach(() => {
    // @ts-ignore
    import.meta.env.PROD = originalProd;
    vi.restoreAllMocks();
  });

  it("should initialize with isUpdateAvailableState as false", () => {
    expect(isUpdateAvailableState.value).toBe(false);
  });

  it("should register service worker and listen to waiting and controlling events in production browser environments", () => {
    initPWA();

    expect(mockAddEventListener).toHaveBeenCalledWith("waiting", expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith("controlling", expect.any(Function));
    expect(mockRegister).toHaveBeenCalled();
  });

  it("should transition isUpdateAvailableState to true when waiting event fires", () => {
    let waitingCallback: () => void = () => {};
    mockAddEventListener.mockImplementation((event: string, callback: () => void) => {
      if (event === "waiting") {
        waitingCallback = callback;
      }
    });

    initPWA();

    // Simulate service worker waiting update trigger
    waitingCallback();

    expect(isUpdateAvailableState.value).toBe(true);
  });

  it("should trigger messageSkipWaiting on Workbox instance when applyAppUpdate is executed", async () => {
    initPWA();
    await applyAppUpdate();

    expect(mockMessageSkipWaiting).toHaveBeenCalled();
  });
});
