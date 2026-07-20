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
} from "./GoogleTtsProvider.ts";

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

describe("GoogleTtsProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    if (originalCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
        originalCredentials;
    }
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
    const provider = makeGoogleTtsProvider(client);

    const audio = await Effect.runPromise(
      provider.synthesize({
        text: "今日は日本語を勉強します。",
        settings: DEFAULT_JAPANESE_TTS_SETTINGS,
      }),
    );

    expect(audio.byteLength).toBe(validMp3.byteLength);
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
      expect(result.left.kind).toBe("authentication");
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
});