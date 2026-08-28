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
3. Gafu rejects missing, duplicated, reordered, malformed, or mismatched cards.
4. The existing session importer validates the complete result before making
   best-effort TTS requests or changing the active session.
5. The validated session is stored locally and the study view opens.

The manual JSON export/import controls remain under **Manual JSON fallback** for
offline operation and troubleshooting. A missing key produces an actionable
configuration error and never exposes server credentials to the client.
