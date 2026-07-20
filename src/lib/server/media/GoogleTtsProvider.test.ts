import { Effect } from "effect";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  GoogleTtsProbeClient,
  GoogleTtsProbeRequest,
} from "../tts/GoogleTtsProbe.ts";
import {
  DEFAULT_JAPANESE_TTS_SETTINGS,
} from "./TtsAssetService.ts";
import {
  makeGoogleTtsProvider,
  validateGoogleCredentialsEnvironment,
  validateStaticCardAudioProvider,
} from "./GoogleTtsProvider.ts";
import {
  makeInMemoryTtsSynthesisBudget,
} from "./TtsSynthesisBudget.ts";

const originalCredentials =
  process.env.GOOGLE_APPLICATION_CREDENTIALS;
const originalViteGoogleCredentials =
  process.env.VITE_GOOGLE_APPLICATION_CREDENTIALS;
const validMp3 = new Uint8Array([
  0x49,
  0x44,
  0x33,
  0x04,
  0x00,
  0x00,
]);

const restoreEnvironment = (
  key: string,
  value: string | undefined,
) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

describe("GoogleTtsProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnvironment(
      "GOOGLE_APPLICATION_CREDENTIALS",
      originalCredentials,
    );
    restoreEnvironment(
      "VITE_GOOGLE_APPLICATION_CREDENTIALS",
      originalViteGoogleCredentials,
    );
  });

  it("passes deterministic synthesis settings to a fake Google client", async () => {
    const synthesizeSpeech = vi.fn(
      (_request: GoogleTtsProbeRequest) =>
        Promise.resolve(validMp3),
    );
    const client: GoogleTtsProbeClient = {
      listVoiceNames: vi.fn(() =>
        Promise.resolve([
          DEFAULT_JAPANESE_TTS_SETTINGS.voiceName,
        ]),
      ),
      synthesizeSpeech,
    };
    const provider = makeGoogleTtsProvider(client, {
      maxTransientRetries: 0,
    });

    const audio = await Effect.runPromise(
      provider.synthesize({
        text: "今日は日本語を勉強します。",
        settings: DEFAULT_JAPANESE_TTS_SETTINGS,
      }),
    );

    expect(audio.byteLength).toBe(
      validMp3.byteLength,
    );
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      input: {
        text: "今日は日本語を勉強します。",
      },
      voice: {
        languageCode: "ja-JP",
        name: "ja-JP-Neural2-B",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.95,
      },
    });
  });

  it("retries only transient Google failures", async () => {
    let attempts = 0;
    const synthesizeSpeech = vi.fn(
      (_request: GoogleTtsProbeRequest) => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(
            Object.assign(
              new Error("UNAVAILABLE"),
              { code: 14 },
            ),
          );
        }
        if (attempts === 2) {
          return Promise.reject(
            Object.assign(
              new Error("DEADLINE_EXCEEDED"),
              { code: 4 },
            ),
          );
        }
        return Promise.resolve(validMp3);
      },
    );
    const client: GoogleTtsProbeClient = {
      listVoiceNames: vi.fn(() =>
        Promise.resolve([
          DEFAULT_JAPANESE_TTS_SETTINGS.voiceName,
        ]),
      ),
      synthesizeSpeech,
    };
    const provider = makeGoogleTtsProvider(client, {
      maxTransientRetries: 2,
      retryBaseDelayMs: 0,
    });

    const audio = await Effect.runPromise(
      provider.synthesize({
        text: "再試行します。",
        settings: DEFAULT_JAPANESE_TTS_SETTINGS,
      }),
    );

    expect(audio.byteLength).toBe(
      validMp3.byteLength,
    );
    expect(synthesizeSpeech).toHaveBeenCalledTimes(3);
  });

  it("does not retry authentication failures", async () => {
    const synthesizeSpeech = vi.fn(() =>
      Promise.reject(
        Object.assign(
          new Error("UNAUTHENTICATED"),
          { code: 16 },
        ),
      ),
    );
    const client: GoogleTtsProbeClient = {
      listVoiceNames: vi.fn(() =>
        Promise.resolve([
          DEFAULT_JAPANESE_TTS_SETTINGS.voiceName,
        ]),
      ),
      synthesizeSpeech,
    };
    const provider = makeGoogleTtsProvider(client, {
      maxTransientRetries: 3,
      retryBaseDelayMs: 0,
    });

    const result = await Effect.runPromise(
      Effect.either(
        provider.synthesize({
          text: "認証に失敗します。",
          settings:
            DEFAULT_JAPANESE_TTS_SETTINGS,
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    if (result._tag === "Left") {
      expect(result.left.kind).toBe(
        "authentication",
      );
      expect(result.left.retryable).toBe(false);
    }
  });

  it("stops before Google when the daily budget is exhausted", async () => {
    const synthesizeSpeech = vi.fn(() =>
      Promise.resolve(validMp3),
    );
    const client: GoogleTtsProbeClient = {
      listVoiceNames: vi.fn(() =>
        Promise.resolve([
          DEFAULT_JAPANESE_TTS_SETTINGS.voiceName,
        ]),
      ),
      synthesizeSpeech,
    };
    const budget =
      makeInMemoryTtsSynthesisBudget(
        1,
        () => "2026-07-20",
      );
    const provider = makeGoogleTtsProvider(client, {
      usageBudget: budget,
      maxTransientRetries: 0,
    });

    await Effect.runPromise(
      provider.synthesize({
        text: "一回目です。",
        settings: DEFAULT_JAPANESE_TTS_SETTINGS,
      }),
    );
    const result = await Effect.runPromise(
      Effect.either(
        provider.synthesize({
          text: "二回目です。",
          settings:
            DEFAULT_JAPANESE_TTS_SETTINGS,
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("limit");
    }
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when an explicit credential file is missing", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS =
      "/private/never-log-this-google-file.json";

    const result = await Effect.runPromise(
      Effect.either(
        validateGoogleCredentialsEnvironment(),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe(
        "authentication",
      );
      expect(result.left.message).toContain(
        "missing or unreadable",
      );
      expect(result.left.message).not.toContain(
        "/private",
      );
      expect(result.left.message).not.toContain(
        "never-log-this",
      );
    }
  });

  it("rejects credentials exposed through Vite variables", async () => {
    process.env.VITE_GOOGLE_APPLICATION_CREDENTIALS =
      "/private/google.json";

    const result = await Effect.runPromise(
      Effect.either(
        validateGoogleCredentialsEnvironment(),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe(
        "configuration",
      );
      expect(result.left.message).toContain(
        "server-side",
      );
      expect(result.left.message).not.toContain(
        "/private/google.json",
      );
    }
  });

  it("keeps Vapi disabled for static card synthesis", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        validateStaticCardAudioProvider("vapi"),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe(
        "configuration",
      );
      expect(result.left.message).toContain(
        "Vapi remains disabled",
      );
    }
  });
});
