# Google Cloud TTS smoke probe

The probe is server-only and fixed to `ja-JP-Neural2-B`, MP3, and a
`0.95` speaking rate. Never place Google credentials in a `VITE_` variable.

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

## Tests

```bash
pnpm install
pnpm check-types
pnpm test:node
pnpm tts:smoke
```

Play `tmp/tts-smoke/ja-JP-Neural2-B.mp3` and confirm the complete sentence
`今日は日本語の勉強を続けます。` is pronounced correctly.

The probe must fail clearly without exposing the credential path:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/definitely/missing/google.json \
pnpm tts:smoke
```