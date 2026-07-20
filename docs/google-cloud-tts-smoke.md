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
bun install
bun run check-types
bunx vitest run src/lib/server/media
bun run test:node
```

The optional real-provider integration test is disabled by default:

```bash
bun run tts:test:integration
```

## Deterministic smoke run

Run the same sentence twice:

```bash
bun run tts:smoke
bun run tts:smoke
```

The first run should report `miss`. The second should report `hit` and should
not call Google again. Both runs maintain a playable convenience copy at
`tmp/tts-smoke/ja-JP-Neural2-B.mp3`.

Confirm the complete sentence `今日は日本語の勉強を続けます。` is pronounced
correctly.

The probe must fail clearly without exposing the credential path:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/definitely/missing/google.json \
bun run tts:smoke
```

The canonical cached asset lives beneath `tmp/tts-smoke/assets/tts/`. Its
identity includes normalized text, language, voice, speaking rate, encoding,
and synthesis version.

## Step 3 session-import enrichment

The client validates the complete payload before requesting audio. Cards with an
existing `audio_url` bypass synthesis. Missing audio is sent to the authenticated
`POST /api/tts/enrich-session` endpoint, where duplicate sentences are collapsed
before the deterministic TTS asset service is called.

Run the Step 3 checks with Bun:

```bash
bun run check-types
bunx vitest run src/lib/client/stores/activeSessionStore.test.ts
bunx vitest run src/lib/client/stores/sessionSyncStore.test.ts
bun run test:node
bun run test:client
```

Then start the app:

```bash
bun run dev
```

Import a representative 15-card payload. Every successful card should expose the
Listen button. If Google TTS or object storage fails for part of the batch, the
study session must still load and display one warning summarizing how many cards
have no audio.

## Step 4 production safeguards

Static card assets are Google-only. `STATIC_CARD_AUDIO_PROVIDER` defaults to
`google`; setting it to `vapi` or another provider causes the enrichment route
to fail closed before synthesis. Vapi is not used for deterministic card audio.

The default server-side safeguards are:

- `TTS_MAX_ITEMS_PER_IMPORT=100`
- `TTS_DAILY_SYNTHESIS_LIMIT=200`
- `TTS_CONCURRENCY_LIMIT=3`
- `TTS_MAX_TRANSIENT_RETRIES=2`
- `TTS_RETRY_BASE_DELAY_MS=250`
- `PUBLIC_TTS_BASE_URL` falls back to the existing `PUBLIC_AVATAR_URL`

The daily ceiling is stored in PostgreSQL and counts cache-miss synthesis
attempts. Cache hits do not consume the daily budget. Apply the migration before
running the server:

```bash
bun run db:migrate
```

Google retries are restricted to transient `UNAVAILABLE` and
`DEADLINE_EXCEEDED` failures. Authentication, permission, malformed audio,
configuration, storage, and daily-limit failures are not retried.

### Object-storage CORS

Local MinIO applies `config/minio-tts-cors.xml` during bucket creation. For a
remote S3-compatible bucket, configure the application origins explicitly:

```bash
TTS_CORS_ALLOWED_ORIGINS="https://your-app.example" \
bun run tts:configure-cors
```

After generating an asset, verify its public URL, CORS response, immutable cache
metadata, `audio/mpeg` content type, and MP3 header:

```bash
TTS_ASSET_URL="https://media.example/tts/ja-JP/..." \
TTS_APP_ORIGIN="https://your-app.example" \
bun run tts:verify-asset
```

Never use credential-bearing variables beginning with `VITE_`. Development and
production builds fail early if Google, AWS, TTS, or Vapi credentials are
detected in client-exposed environment variables.

### Step 4 tests

```bash
bun run check-types
bun run test:node
bun run test:client
bun run test:e2e
bun run build
```

The E2E suite enables the development service worker and confirms that a valid
MP3 is cached in `learning-audio-media`, the page reloads offline, and the audio
element can load the cached response.

### Manual online and offline verification

Start the PWA-enabled development environment:

```bash
bun run dev:offline
```

1. Import a representative payload and wait for the
   `[MediaPrewarm] Cycle complete` or immediate prewarm log.
2. Play several cards and confirm each audio request returns HTTP 200 with
   `Content-Type: audio/mpeg`.
3. In browser DevTools, confirm the URLs exist under Cache Storage →
   `learning-audio-media`.
4. Switch the browser network to Offline and reload the study route.
5. Confirm the session hydrates from IndexedDB and cached audio still loads.

For ordinary development without a service worker, continue using
`bun run dev`.

