# API-generated study sessions

Gafu can generate and start the Study Desk's daily or cram session without the
manual JSON copy/paste handshake.

## Configuration

Set the OpenAI key only in the server environment. For local development, put
this in the ignored `.env` file at the repository root:

```dotenv
OPENAI_API_KEY=sk-your-key
```

Restart `pnpm dev` after changing the environment. Do not use a `VITE_`
variable and do not enter the key in the browser. The client sends its bounded
study queue and vocabulary constraints to the authenticated
`POST /api/ai/generate-session` endpoint; only the server calls OpenAI. Prompt
instructions are also server-owned—the browser can submit only a bounded mode,
queue, and vocabulary pool.

## Runtime flow

1. The client calculates the same due/new or cram queue used by the previous
   export flow.
2. The server requests structured output with exactly one card per queue item.
   The generated Japanese sentence is the sole textual authority; the provider
   is not asked to duplicate it as furigana. The English context describes the
   surrounding scene immediately before the learner speaks; the Japanese
   sentence is the learner's next utterance within that scene, not a translation
   of the context.
3. The provider must explicitly attest that every context stops before speech
   and omits the Japanese utterance's meaning. Gafu rejects cards with missing
   quality checks, missing or duplicated IDs, changed ordering, or malformed
   fields.
4. The browser derives full-sentence furigana with the bundled Japanese
   tokenizer. Token spans are checked against every character, including
   whitespace and punctuation. If tokenization is unavailable or inconsistent,
   Gafu preserves the complete sentence as plain Japanese instead of rejecting
   the session or displaying partial text.
5. The existing session importer validates the complete result before making
   best-effort TTS requests or changing the active session.
6. The validated session is stored locally and the study view opens.

The manual JSON export/import controls remain under **Manual JSON fallback** for
offline operation and troubleshooting. A missing key produces an actionable
configuration error and never exposes server credentials to the client.
