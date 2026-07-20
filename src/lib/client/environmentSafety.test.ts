import { describe, expect, it } from "vitest";
import {
  assertNoClientCredentialEnvironment,
  findForbiddenClientCredentialKeys,
} from "../shared/clientEnvironmentSafety.ts";

describe("clientEnvironmentSafety", () => {
  it("allows non-secret public Vite configuration", () => {
    expect(
      findForbiddenClientCredentialKeys({
        VITE_API_BASE_URL: "https://app.example.test",
        VITE_PWA_DEV: "true",
      }),
    ).toEqual([]);
  });

  it("rejects Google, AWS, TTS, and Vapi credentials in Vite variables", () => {
    const environment = {
      VITE_GOOGLE_APPLICATION_CREDENTIALS: "/private/google.json",
      VITE_AWS_SECRET_ACCESS_KEY: "secret",
      VITE_TTS_API_KEY: "secret",
      VITE_VAPI_API_KEY: "secret",
    };

    expect(
      findForbiddenClientCredentialKeys(environment),
    ).toEqual([
      "VITE_AWS_SECRET_ACCESS_KEY",
      "VITE_GOOGLE_APPLICATION_CREDENTIALS",
      "VITE_TTS_API_KEY",
      "VITE_VAPI_API_KEY",
    ]);
    expect(() =>
      assertNoClientCredentialEnvironment(environment),
    ).toThrow("Server credentials must not use VITE_ variables");
  });
});
