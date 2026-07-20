# Google Cloud TTS deterministic asset smoke test

The server-side synthesis path is fixed initially to `ja-JP-Neural2-B`,
MP3, a `0.95` speaking rate, and synthesis version `1`. Never place Google
credentials in a `VITE_` variable.

## One-time setup

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable texttospeech.googleapis.com
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

A server-side `GOOGLE_APPLICATION_CREDENTIALS` service-account file is also
supported. Do not commit it.

## Verify the voice directly

```bash
PROJECT_ID="$(gcloud config get-value project)"
curl -sS \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  "https://texttospeech.googleapis.com/v1/voices?languageCode=ja-JP" \
  | grep -F "ja-JP-Neural2-B"
```

## Step 2 tests

```bash
pnpm install
pnpm check-types
pnpm vitest run src/lib/server/media
pnpm test:node
```

The optional real-provider integration test is disabled by default:

```bash
pnpm tts:test:integration
```

## Deterministic smoke run

Run the same sentence twice:

```bash
pnpm tts:smoke
pnpm tts:smoke
```

The first run should report `miss`. The second should report `hit` and should
not call Google again. Both runs maintain a playable convenience copy at
`tmp/tts-smoke/ja-JP-Neural2-B.mp3`.

Confirm the complete sentence `今日は日本語の勉強を続けます。` is pronounced
correctly.

The probe must fail clearly without exposing the credential path:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/definitely/missing/google.json \
pnpm tts:smoke
```

The canonical cached asset lives beneath `tmp/tts-smoke/assets/tts/`. Its
identity includes normalized text, language, voice, speaking rate, encoding,
and synthesis version.
