# Adaptive media release runbook

## Release posture

Adaptive media starts at the `internal` rollout stage. General availability is
not permitted until the legal and human-Japanese sign-offs below are recorded.
Ordinary study, sync, and local progress remain available when either adaptive
media control is disabled.

| Control | Scope | Safe value |
| --- | --- | --- |
| `VITE_ADAPTIVE_MEDIA_WATCH_ENABLED` | Build-time client Watch route/navigation | `false` hides Watch without affecting study |
| `ADAPTIVE_MEDIA_AI_ADMISSION_ENABLED` | Runtime server recommendation analysis and acceptance of new media targets | `false` stops new AI-derived debt; existing checkout/cached review still works |
| `ADAPTIVE_MEDIA_ROLLOUT_STAGE` | Operational cohort label | `internal`, then `development_opt_in`, `limited_beta`, `general_availability` |

Emergency disable: set `ADAPTIVE_MEDIA_AI_ADMISSION_ENABLED=false` and restart
the server. If Watch itself is unsafe, build with
`VITE_ADAPTIVE_MEDIA_WATCH_ENABLED=false`. Neither action rolls back data or
postpones due reviews. Re-enable only after the owning failure is fixed and the
release evaluation command passes.

## Privacy and deletion

- Video/audio bytes, object URLs, file names, source-signature keys, lexical
  sketches, and semantic signatures stay in the browser.
- Optional analysis sends at most 12 explicitly consented subtitle excerpts,
  each at most 280 characters. Gafu does not persist those raw excerpts; the
  configured AI provider's retention and regional-processing terms still apply.
- Synced provenance contains cue IDs, timing transform IDs, timestamps, point
  IDs, dispositions, and validation versions. Structured metrics accept only
  allow-listed IDs, counts, booleans, and outcomes.
- “Delete adaptive-media data” removes server-side analysis/candidates,
  provenance, pending checkouts, and generated exercises, and clears the current
  browser's exercise cache and private source signatures. It preserves the
  point-level SRS record so media-history deletion cannot erase unrelated study.
- Clearing site data independently removes the browser-private stores. Other
  devices must be cleared separately.

## Migration and rollback

The migration rehearsal creates an isolated database, applies migrations 00–08,
loads a populated grammar/SRS snapshot with non-default scheduling and HLC data,
then applies migrations 09–12. It asserts metric preservation, shared point
identity, `checkout_due`, and all adaptive tables. Run:

```sh
DATABASE_URL_TEST=postgres://... pnpm exec vitest run src/migrations/09_adaptive_knowledge_points.test.ts
```

Database down migrations are destructive and are not the operational rollback.
Disable admission/Watch first, retain the migrated schema, diagnose, then ship a
forward migration. Restore from the pre-migration backup only for a verified
database-corruption incident under the normal database recovery process.

## Promotion gates

Before each stage promotion:

1. Run `pnpm test:adaptive-eval`, the focused adaptive suite, typecheck, browser
   tests, Chrome/Firefox E2E, and production/PWA build.
2. Review every promoted prompt/model pair using the versioned synthetic corpus.
3. Obtain a Japanese human review of all `pending_human` casual and polite rows;
   record reviewer, date, prompt version, model version, and decision without
   replacing the synthetic fixture with copyrighted dialogue.
4. Obtain legal approval for the configured AI provider, including retention,
   deletion, regional processing, and the exact consent copy.
5. Inspect privacy-safe metrics for source-validation rejection, capacity,
   checkout completion, queue starvation, and varied-context mastery.

The FFmpeg browser-core licence remains an explicit optional-capability gate.
Until approved, localhost may use installed system FFmpeg for Firefox-compatible
Opus repair and alignment; hosted playback uses original audio and manual/local
alignment. Playback must never fall back to a remote media upload.
