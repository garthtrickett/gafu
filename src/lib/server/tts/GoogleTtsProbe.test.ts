import { Buffer } from "node:buffer";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GOOGLE_TTS_SMOKE_TEXT,
  GOOGLE_TTS_PROBE_CONFIG,
  GoogleTtsProbeError,
  synthesizeGoogleTtsAudio,
  synthesizeGoogleTtsProbe,
  type GoogleTtsProbeClient,
  type GoogleTtsProbeRequest,
} from "./GoogleTtsProbe.ts";

const originalCredentials =
  process.env.GOOGLE_APPLICATION_CREDENTIALS;
const validMp3 = new Uint8Array([
  0x49,
  0x44,
  0x33,
  0x04,
  0x00,
  0x00,
]);

const makeClient = (
  overrides: Partial<GoogleTtsProbeClient> = {},
): GoogleTtsProbeClient => ({
  listVoiceNames: vi.fn(() =>
    Promise.resolve([GOOGLE_TTS_PROBE_CONFIG.voiceName]),
  ),
  synthesizeSpeech: vi.fn(() => Promise.resolve(validMp3)),
  ...overrides,
});

describe("GoogleTtsProbe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
        originalCredentials;
    }
  });

  it("builds the fixed Japanese Neural2 MP3 request", async () => {
    const synthesizeSpeech = vi.fn(
      (_request: GoogleTtsProbeRequest) => Promise.resolve(validMp3),
    );
    const client = makeClient({ synthesizeSpeech });

    const audio = await Effect.runPromise(
      synthesizeGoogleTtsProbe(DEFAULT_GOOGLE_TTS_SMOKE_TEXT, client),
    );

    expect(audio).toEqual(Buffer.from(validMp3));
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      input: { text: DEFAULT_GOOGLE_TTS_SMOKE_TEXT },
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

  it("fails before synthesis when the fixed voice is unavailable", async () => {
    const synthesizeSpeech = vi.fn(
      (_request: GoogleTtsProbeRequest) => Promise.resolve(validMp3),
    );
    const client = makeClient({
      listVoiceNames: vi.fn(() =>
        Promise.resolve(["ja-JP-Neural2-C"]),
      ),
      synthesizeSpeech,
    });

    const result = await Effect.runPromise(
      Effect.either(synthesizeGoogleTtsProbe(undefined, client)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GoogleTtsProbeError);
      expect(result.left.kind).toBe("configuration");
    }
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("sanitizes a missing ADC file error", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS =
      "/private/never-log-this.json";
    const client = makeClient({
      listVoiceNames: vi.fn(() =>
        Promise.reject(
          Object.assign(
            new Error(
              "ENOENT: no such file, open '/private/never-log-this.json'",
            ),
            { code: "ENOENT" },
          ),
        ),
      ),
    });

    const result = await Effect.runPromise(
      Effect.either(synthesizeGoogleTtsProbe(undefined, client)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("authentication");
      expect(result.left.message).toContain(
        "Application Default Credentials",
      );
      expect(result.left.message).not.toContain("/private");
      expect(result.left.message).not.toContain("never-log-this");
    }
  });

  it("rejects malformed MP3 output", async () => {
    const client = makeClient({
      synthesizeSpeech: vi.fn(() =>
        Promise.resolve(new Uint8Array([0x00, 0x01, 0x02])),
      ),
    });

    const result = await Effect.runPromise(
      Effect.either(synthesizeGoogleTtsProbe(undefined, client)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("audio");
    }
  });

  it("marks UNAVAILABLE failures as retryable", async () => {
    const client = makeClient({
      synthesizeSpeech: vi.fn(() =>
        Promise.reject(
          Object.assign(
            new Error("UNAVAILABLE"),
            { code: 14 },
          ),
        ),
      ),
    });

    const result = await Effect.runPromise(
      Effect.either(
        synthesizeGoogleTtsAudio(
          "一時的な失敗です。",
          GOOGLE_TTS_PROBE_CONFIG,
          client,
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("provider");
      expect(result.left.retryable).toBe(true);
    }
  });

  it("marks permission failures as non-retryable", async () => {
    const client = makeClient({
      synthesizeSpeech: vi.fn(() =>
        Promise.reject(
          Object.assign(
            new Error("PERMISSION_DENIED"),
            { code: 7 },
          ),
        ),
      ),
    });

    const result = await Effect.runPromise(
      Effect.either(
        synthesizeGoogleTtsAudio(
          "権限がありません。",
          GOOGLE_TTS_PROBE_CONFIG,
          client,
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("provider");
      expect(result.left.retryable).toBe(false);
    }
  });
});
