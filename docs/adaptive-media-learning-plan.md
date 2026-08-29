# Adaptive Media Learning Implementation Plan

**Status:** Phases 0–5 implemented; internal rollout ready, general availability held by documented external approvals

**Last updated:** 2026-08-28

**Product specification:** `docs/adaptive-media-learning-prd.md`

**Related product direction:** `PRD.md`

## Implementation status

Phases 0–5 are implemented in Gafu. The shared grammar/vocabulary model, local
player, adaptive syllabus, prime/encounter/checkout loop, varied exercise bank,
release controls, privacy deletion, evaluation corpus, metrics, and migration
rehearsal all have automated evidence. The retained `jp-player` behavior and
tests have moved into Gafu, and `jp-player` is deprecated as a dependency.

The product remains at the `internal` rollout stage until the pending Japanese
human-review rows, AI-provider legal review, and optional FFmpeg licence decision
are signed off. These are release-promotion holds, not missing engineering work;
the safe fallback keeps playback local with original audio and manual timing.

## Outcome

Deliver an authenticated Gafu Watch area that turns a learner-selected local
video and Japanese subtitle track into a capacity-limited syllabus, primes the
accepted grammar and vocabulary points, records their natural encounters, and
schedules varied retrieval without storing or deliberately repeating episode
dialogue.

The `jp-player` repository is a temporary migration source. Relevant code,
tests, assets, dependency licences, and behavior move into Gafu. Gafu must have
no runtime, build, or release dependency on `jp-player` before that repository
is marked deprecated and archived or made read-only.

## Non-negotiable invariants

Every phase preserves these rules:

1. One user has at most one SRS schedule for a knowledge point, regardless of
   how many media encounters or generated exercises exist.
2. Grammar and vocabulary use the same scheduling infrastructure.
3. The exact episode line appears only during natural playback. It is never a
   primer, checkout prompt, card, TTS input, or later generated exercise.
4. Passive playback never improves SRS stability.
5. Newly primed points are due and prioritized in eligible sessions; product
   language never claims Gafu can guarantee learner attendance.
6. Video and audio remain local. A hosted Gafu endpoint never accepts a video
   upload for playback, repair, analysis, or alignment.
7. AI output cannot directly create a shared curated definition or bypass
   deterministic evidence, canonicalization, capacity, or exercise validation.
8. Playback remains usable when tokenization, alignment, AI, TTS, or syllabus
   generation fails.
9. Candidate disposition, catalogue status, learner participation, and learner
   mastery remain separate state axes.
10. Raw subtitle text, generated answers, local filenames, and source-signature
    material never enter logs.

## Current baseline

### Gafu

- PostgreSQL `srs_card` rows point directly to `grammar_point_id`, and the unique
  schedule constraint is `(user_id, grammar_point_id)`.
- Sync payloads, local stores, active study sessions, and review actions all use
  `grammarPointId`.
- FSRS-lite difficulty and stability already exist and must be preserved.
- The client uses Lit, signals, Effect, a custom IndexedDB store, and an HLC
  outbox/pull sync flow.
- The AI route currently generates one context/Japanese/furigana structure from
  an untyped free-form prompt; it does not implement media recommendation or
  exercise validation contracts.
- Gafu has no Watch route or player component.

### Yomikata (`jp-player`)

- Subtitle parsing, active-cue lookup, Kuromoji tokenization, audio repair,
  subtitle alignment, and player behavior already work in a standalone Vite
  app.
- Cue IDs are positional and token output discards lemma, part-of-speech,
  conjugation, and span metadata.
- Most UI, file, clock, and event behavior is centralized in `src/main.js`.
- Native FFmpeg behavior is implemented as local Vite middleware. Those routes
  cannot be copied to hosted Gafu as remote upload endpoints.
- Existing automated coverage directly tests subtitle parsing and the alignment
  algorithm. Player interaction, audio repair, and privacy behavior need parity
  coverage before deprecation.

## Delivery strategy

### Sequence

The work is intentionally ordered as:

```text
contracts and baselines
    -> shared knowledge model
    -> media migration and syllabus
    -> prime/watch/checkout
    -> generative review
    -> release hardening and jp-player deprecation
```

The shared knowledge model lands before media-derived points. Player modules
land before syllabus UI. Source-distinct generation and validation land before
any media-derived exercise can enter review.

### Change shape

- Use small, independently reviewable slices within each phase.
- Prefer expand/backfill/cut-over/contract database changes over a destructive
  single-deploy schema replacement.
- Keep the existing grammar study path working until its reads, writes, sync,
  restore, and tests have moved to `knowledgePointId`.
- Put unfinished Watch behavior behind an authenticated feature flag or
  unreachable development route until its phase exit gate passes.
- Use synthetic or explicitly redistributable subtitle/audio/video fixtures.
- Do not persist local `File` objects or object URLs across sessions.

### Dependency and licence gate

Before moving browser code, produce a dependency and licence inventory for
Kuromoji, the Kuromoji dictionary, FFmpeg WASM packages, and the Japanese font.
Obtain approval for any dependency newly added to Gafu. Copy attribution and
licence notices with migrated assets. Do not vendor generated dictionaries,
WASM, fonts, or third-party code without confirming their redistribution terms.

## Phase 0: Contracts, fixtures, and parity baseline

### Purpose

Turn the PRD's cross-cutting invariants into versioned contracts and establish a
behavioral baseline before either schema or player code moves.

### Work packages

#### 0.1 Domain and state contracts

Define shared TypeScript/Effect schemas for:

- `KnowledgePointKind`, canonical identity, scope, and catalogue status;
- learner participation and learning states with allowed transitions;
- media candidate disposition;
- normalized subtitle cue, token, target span, and timing transform;
- media encounter and review-event inputs;
- generated exercise, validation outcome, and variation tags; and
- version identifiers for token normalization and `source_signature_v1`.

Use UTF-16 code-unit offsets into the versioned normalized cue text because that
is the unit used by JavaScript `slice` and browser DOM ranges. Include fixture
tests around surrogate pairs, combining marks, NFKC changes, and line breaks so
no caller silently treats offsets as Unicode code points or bytes.

Write transition-table tests proving that passive encounter cannot produce
`stable`, rejected candidates cannot create schedules, and learner actions do
not globally quarantine curated points.

#### 0.2 Copyright-safe fixture corpus

Create small SRT and ASS fixtures covering:

- multiline cues, overlapping cues, tags, commas, invalid records, and ordering;
- spoken contractions, inflections, names, ambiguous lemmas, and punctuation;
- global offset and gradual timing drift;
- exact, lexical near-copy, semantic near-copy, and genuinely varied sentences;
  and
- known/unknown learner profiles at zero, moderate, and healthy capacity.

No fixture may contain unlicensed commercial dialogue.

#### 0.3 Yomikata parity inventory

Record the behavior that must survive migration:

- MKV, MP4, and WebM selection;
- ASS, SSA, and SRT parsing;
- active timed subtitles, furigana, spacing, font-size controls, seek shortcuts,
  fullscreen, mute, and repaired-audio clock ownership;
- automatic alignment, confidence fallback, and manual offset;
- browser-WASM audio repair fallback; and
- failure behavior when codecs, dictionary, FFmpeg, or alignment are absent.

Pin the exact `jp-player` source commit used for the parity inventory and retain
a source-to-destination file/behavior map. Later changes in the old repository
do not silently expand the migration after this baseline is approved.

Add missing tests in `jp-player` only when needed to define migration parity;
new product behavior belongs in Gafu.

#### 0.4 AI evaluation harness skeleton

Create a versioned, non-production evaluation format for recommendation and
exercise cases. It must store synthetic cue evidence, learner profiles,
expected canonical matches/rejections, and source-similarity expectations.
Production prompts and models cannot be promoted without running this set.

### Exit gate

- Shared schemas compile and their state-transition tests pass.
- The fixture corpus is reviewed for copyright safety.
- Every Yomikata behavior is classified as migrate, replace, or explicitly
  defer; nothing disappears accidentally.
- Current `jp-player` tests and build pass before migration begins.
- Open product decisions needed by Phases 1 and 2 have named owners and decision
  deadlines.

## Phase 1: Shared knowledge and scheduling foundation

### Purpose

Replace the grammar-only identity boundary with one lossless grammar/vocabulary
knowledge model while preserving all existing learner progress and the current
study experience.

### Work packages

#### 1.1 Expand the server schema

Add the shared `knowledge_point` identity and kind-specific grammar and
vocabulary detail records. Prefer preserving each current grammar UUID as its
new knowledge-point UUID, with the existing grammar row becoming or referencing
the grammar detail for that identity.

Expand `srs_card` with a nullable `knowledge_point_id`, backfill it, and verify:

- every existing grammar schedule maps to exactly one knowledge point;
- review dates, repetitions, intervals, ease, difficulty, stability,
  `last_reviewed_at`, HLC, timestamps, and user ownership are unchanged; and
- no `(user_id, knowledge_point_id)` duplicates exist.

Add the new unique constraint only after the backfill audit passes. Keep the old
grammar foreign key during compatibility deployment; remove it in a later
contract migration after all readers and writers use the new identity.

The physical `srs_card` table may retain its current name during Phase 1 to keep
the migration small; after cut-over it represents a point-level schedule, not a
sentence card. Renaming that table is optional cleanup and must not be coupled to
the semantic migration.

#### 1.2 Cut server reads, writes, and sync over

- Change review schemas and transactions from `grammarPointId` to
  `knowledgePointId`.
- Version the sync contract or bump the existing sync epoch so an old client
  cannot silently write a grammar-only payload after cut-over.
- Update pull serialization, push conflict targets, seed, progress restore,
  generated database types, and migration manifest.
- Make mixed-version behavior explicit: compatible payloads are translated only
  during the planned window; unsupported versions fail visibly and recoverably.

#### 1.3 Migrate client collections and study code

- Add a client database migration that creates knowledge-point catalogue and
  learner-progress collections from the current grammar collections.
- Preserve per-user IndexedDB isolation and make the migration idempotent and
  interruption-safe.
- Replace `grammarPointStore`, `SessionCard.grammarPointId`, study actions, logs,
  and queue grouping with knowledge-point terminology.
- Keep grammar-specific teaching details behind the grammar subtype rather than
  copying them into generic progress.
- Add vocabulary lemma, reading, part of speech, sense key, meaning, register,
  and personal/curated scope.

#### 1.4 Establish lifecycle and capacity primitives

- Implement the permitted learner-state transitions from Phase 0.
- Add user-scoped participation status and exclude archived progress from the
  active queue.
- Represent already-known knowledge as learner progress without an active due
  review; self-reporting `known` must not manufacture a successful review event
  or inflate measured stability.
- Implement one global daily new-target counter across grammar and vocabulary.
- Add projected seven-day cost, failure buffer, unstable-pool count, and queue
  priority categories as deterministic pure functions.
- Start with the PRD safeguards: default three new points, hard maximum five,
  maximum twenty unstable recent points, and higher projected cost for grammar
  and difficult vocabulary.
- Order an opened review session as: today's checkout, points introduced in the
  last seven days, normally due mature points, then overdue lower-risk mature
  points. Mature backlog can block admission but cannot reorder ahead of an
  already primed point.
- Add an idempotent, server-authoritative introduction-admission record so two
  offline or concurrent devices cannot independently exceed the global daily
  limit. The client may preview capacity, but sync conflict resolution enforces
  the hard maximum of five and reconciles a rejected reservation visibly.
- Define the learner-day boundary from an explicit stored time zone and keep the
  same day key across client previews and server enforcement.
- Record attendance separately from application-controlled queue starvation.

### Validation

- Migration tests from a populated pre-change database, including retry after an
  interrupted backfill. Test application rollback while the additive schema
  remains in place; after contract migration, recovery uses a verified backup
  rather than a destructive down migration that could discard new vocabulary.
- A database assertion that every old grammar schedule retains identical review
  metrics and exactly one new identity.
- Sync tests for current, compatibility, stale-epoch, duplicate, and malformed
  review payloads.
- Client migration tests for multiple users, empty stores, partial migration,
  repeated migration, and offline restart.
- Existing grammar study, TTS, seed/restore, and review tests remain green.
- New vocabulary and grammar points both exercise the same scheduling functions.

### Exit gate

- All production reads and writes use `knowledgePointId`.
- Existing grammar progress is byte-for-byte or field-for-field accounted for.
- A user cannot acquire two schedules for the same point under concurrent or
  replayed sync transactions.
- Vocabulary points can be marked known, introduced, archived, and reviewed
  without a grammar-specific code path.
- The old grammar foreign key can be removed safely, even if its contract
  migration is scheduled separately.

## Phase 2: Media foundation and episode syllabus

### Purpose

Move the relevant Yomikata implementation into Gafu, establish local media and
evidence contracts, and produce a validated zero-to-three-target episode
syllabus without revealing source dialogue.

### Work packages

#### 2.1 Migrate Yomikata into Gafu modules

Move behavior, not the standalone page, into Gafu-owned modules such as:

- subtitle parsing and active-cue lookup;
- Japanese tokenization and fallback tokenization;
- playback clock and typed cue lifecycle events;
- media fingerprinting;
- audio repair adapters;
- subtitle alignment algorithm and timing transforms; and
- a Lit Watch view/controller using Gafu's existing Effect, signals, logging,
  routing, and testing conventions.

Port relevant `jp-player` tests to Gafu's Vitest/browser/E2E suites. Do not retain
a git, npm, runtime, iframe, HTTP, or build dependency on `jp-player`.

#### 2.2 Replace session-local parser contracts

- Hash exact subtitle bytes into `subtitle_track_fingerprint`.
- Derive cue IDs from track fingerprint, format, and source-record ordinal before
  chronological sorting.
- Preserve immutable source timestamps and store alignment/manual offset as a
  versioned transform.
- Preserve normalized-text offsets, surface, lemma, reading, full
  part-of-speech hierarchy, conjugation type, and conjugation form from
  Kuromoji.
- Declare normalization and offset-unit versions and validate every AI evidence
  span against the normalized cue. Offsets use the Phase 0 UTF-16 contract.

#### 2.3 Keep all media processing local

- Use object URLs and browser-owned `File` instances for playback.
- Revoke object URLs and release decoder/WASM resources when a file is replaced,
  the Watch view closes, or the component disconnects.
- Use browser/WASM paths for hosted audio repair and analysis.
- For automatic alignment, decode a mono speech-band envelope in the browser and
  run the migrated pure alignment algorithm over typed arrays; do not call the
  old Node `Buffer`/Vite middleware path.
- Do not migrate Yomikata's local Vite FFmpeg middleware into hosted Gafu routes.
- Prefer browser decoding, with an optional development-only loopback helper
  that streams to system FFmpeg when the browser cannot demux the container.
  Hosted production disables the route, non-loopback requests are rejected,
  and a non-loopback browser never sends media bytes to it.
- Fall back to original audio, original subtitle timing, and manual offset when
  repair or automatic alignment is unavailable.
- Add tests that fail if video bytes are passed to `fetch`, sync, AI, logging, or
  persistent Gafu storage.

#### 2.4 Implement local material preprocessing

- Parse and tokenize every cue once per analysis version.
- Resolve dictionary-supported vocabulary lemmas and shortlist grammar spans.
- Count recurrence, first occurrence, surface diversity, and early-window
  eligibility.
- Filter punctuation, names, noise, explicit known points, user exclusions, and
  obvious duplicates.
- Store only local analysis state, track/cue fingerprints, target spans, and the
  minimum provenance required by the PRD.

#### 2.5 Implement source signatures

- Generate and persist `source_signature_v1` locally: normalized exact SHA-256,
  keyed bottom-k lexical sketch, quantized local embedding, and version fields.
- Store the shingle key in device-local secret storage and never log or sync it.
- Validate exact and near-copy fixtures locally.
- Treat missing or incompatible signature tooling as validation unavailable,
  not as a pass.

#### 2.6 Generate and validate recommendations

- Add a structured media-analysis AI contract with bounded cue evidence,
  canonical proposal, observed forms, count, first time, prerequisites,
  confidence, and review-cost class.
- Obtain explicit consent before sending bounded subtitle excerpts; never send a
  full subtitle archive by convenience.
- Use a dedicated media-analysis service and route. Do not reuse the current
  free-form sentence endpoint until prompt/result logging has been removed and
  structured redaction tests prove subtitle excerpts and generated answers
  cannot reach logs, traces, error causes, or metrics.
- Revalidate returned cue IDs and spans locally, then validate vocabulary against
  tokenizer/dictionary output and resolve aliases against Gafu's catalogue.
- Store new discoveries as personal points only after acceptance; AI never
  mutates the curated catalogue.
- Quarantine incorrect analysis evidence without globally changing a curated
  point.

#### 2.7 Apply admission control and render the syllabus

- Rank by readiness, usefulness, recurrence, early occurrence, contextual
  clarity, surface diversity, learner goals, difficulty, and confidence.
- Admit zero to three targets by default, never more than five globally per day,
  and never fill a quota with weak candidates.
- Reserve accepted introductions through the Phase 1 authoritative admission
  transaction before a primer can begin. If another device consumed capacity,
  explain the conflict and offer reinforcement rather than creating local debt.
- When capacity is zero, offer reinforcement from active learning points found
  in the episode or no syllabus.
- Show canonical target, reading, general meaning, rationale, approximate
  encounter timing/count, difficulty, and confidence without showing source
  dialogue.
- Require explicit learner acceptance for a target outside the early encounter
  window and label it as later; never silently weaken the early-window rule.
- Support accept, replace, reduce, reject, already-known, and not-useful actions.
- Show cancellable analysis progress without blocking playback, and explain
  reinforcement/zero-target results rather than presenting them as errors.

#### 2.8 Consolidate repository ownership

After the Gafu parity suite passes:

1. Confirm Gafu contains all migrate-classified source, tests, assets, licences,
   and documentation.
2. Search Gafu and deployment configuration for any remaining `jp-player`
   dependency or URL.
3. Publish the Gafu Watch replacement.
4. Update `jp-player` README with the deprecation date and Gafu destination.
5. Archive or make `jp-player` read-only only after the replacement is usable.

Preserve the pinned source SHA and migration map in Gafu documentation so future
maintainers can trace copied behavior after the old repository is archived.

### Validation

- Ported parser/alignment unit tests plus stable-ID, normalized-span, malformed
  subtitle, overlapping-cue, and alignment-transform tests.
- Browser tests for file selection, furigana, timing, controls, markers disabled,
  codec failure, dictionary failure, and manual offset fallback.
- Privacy tests that observe network, logs, IndexedDB, sync outbox, and AI request
  bodies.
- Recommendation contract, evidence, canonical deduplication, low-confidence,
  known-point, zero-capacity, and AI-unavailable tests.
- A parity checklist on Chrome and Firefox for supported fixture formats.

### Exit gate

- Gafu can play the supported local formats without AI.
- Stable cue IDs reproduce after reload of identical subtitle bytes and survive
  timing changes.
- Token evidence contains every required field and all recommended spans validate.
- A learner receives zero to three validated, capacity-safe recommendations with
  no source-line spoiler.
- Video bytes never leave the device.
- Gafu has no dependency on `jp-player`, and the old repository is deprecated
  with a Gafu destination notice before it is archived or made read-only.

## Phase 3: Prime, encounter, and checkout

### Purpose

Complete the first media learning loop while preserving entertainment-first
playback and protecting every primed point from mature backlog.

### Work packages

#### 3.1 Primer generation and validation

- Generate form, reading, sense/function, formation, one known-prerequisite
  example, furigana, audio, one retrieval check, and a listening mission.
- Generate from the canonical target and learner prerequisites, not by
  paraphrasing the episode line.
- Run the device-local source-signature validator before display or TTS.
- Resolve/create the point on acceptance, transition to `introduced` when the
  primer starts, and transition to `primed` only after active retrieval.
- Reserve checkout and next-day queue priority as soon as the point is primed.

#### 3.2 Encounter-aware playback

- Match accepted target spans to stable cue IDs.
- Emit idempotent cue-entered events from the playback controller and record the
  timing-transform version and effective playback time.
- Render subtle optional markers without pausing, explaining, or replaying.
- Record passive encounter analytics without changing stability or recording a
  successful review.
- Permit ordinary manual seek/rewind while ensuring Gafu never schedules a
  source-line replay.

#### 3.3 Stop and end checkout

- Offer checkout when playback ends and preserve an accessible checkout when the
  learner stops early or leaves the Watch area.
- Generate a fresh source-distinct exercise for every primed point, including
  points whose expected cue was not reached.
- Support recalled, not recalled, already known, wrongly analyzed, and not useful.
- Apply shorter failure intervals, archive only user participation for not-useful
  curated points, and quarantine only the appropriate analysis/personal definition.

#### 3.4 Sync and recovery

- Sync point identity, learner progress, candidate disposition, review events,
  and minimal encounter provenance.
- Keep raw cue text, local source signatures, keys, file names, and object URLs
  out of sync payloads.
- Recover primed-but-not-checked-out points after refresh, offline use, or an
  abandoned episode and keep them due.
- Make repeated cue events, checkout submission, and sync replay idempotent.
- Deleting a media-derived personal point removes its user-scoped encounter
  provenance and generated exercises through the normal sync deletion model.
- On a device that lacks the original local source signature, use only synced
  exercises that were already validated on a signature-capable device. New
  generated candidates remain blocked until the original subtitle is loaded and
  its signature is reconstructed.

### Validation

- State-machine tests for every normal and alternative transition.
- Primer/checkout exact and near-copy rejection tests, including validation-tool
  unavailable behavior.
- Queue tests showing fresh due points precede mature backlog and no-session days
  are classified as attendance rather than starvation.
- Browser/E2E tests for accept -> prime -> encounter -> checkout, early stop,
  abandon after priming, manual rewind, disabled markers, offline refresh, and AI
  failure with uninterrupted playback.
- TTS tests proving source dialogue is never submitted for synthesis.

### Exit gate

- Every accepted target is explicitly taught and actively retrieved before its
  planned encounter.
- Natural playback never counts as recall or changes stability.
- Checkout uses a different validated context and survives early exit.
- Newly primed points are offered first whenever an eligible review session opens.
- No deliberate learning surface or TTS request contains the source line.

## Phase 4: Generative review bank and mastery evidence

### Purpose

Turn each media-derived point into durable, varied knowledge without creating a
sentence-level SRS queue.

### Work packages

#### 4.1 Exercise storage beneath the point

- Store generated prompts, answers, target spans, furigana, modality, variation
  tags, prerequisite IDs, signature versions, validation status, and generation
  metadata.
- Keep scheduling only on learner progress; exercise insertion cannot create or
  clone a schedule.
- Store recent exercise fingerprints separately from device-local source
  signatures.

#### 4.2 Generation and validation pipeline

- Generate one uncertain thing at a time using stable prerequisites.
- Validate target presence and intended sense/function, unambiguous answer,
  naturalness, register, spans, furigana, and prerequisite eligibility.
- Reject source similarity locally and reject recent-exercise similarity.
- Keep failed generations out of learner-facing storage.
- Use a validated cached exercise if generation is unavailable; otherwise leave
  the point due with an honest unavailable state.
- Record which source-signature version validated an exercise so a synced cached
  exercise remains distinguishable from an unvalidated generated candidate.

#### 4.3 Variation-aware selection

- Track situation, surrounding vocabulary, tense/conjugation, politeness,
  register, speaker intention, polarity, question form, and modality.
- Select the least-recent compatible exercise that addresses weaknesses and
  increases material variation.
- Replenish the bank without adding schedules.

#### 4.4 Mastery limits

- Require successful retrieval in at least two materially different contexts
  before permitting a long interval.
- Where practical, require more than one surface form or modality for `stable`.
- Treat later passive media occurrences as analytics only; grade a later media
  event only when the learner explicitly retrieves before reveal.

### Validation

- Generator contract and deterministic validator unit tests.
- Evaluation cases for incorrect sense, absent target, unknown prerequisite,
  ambiguous answer, unnatural register, invalid spans/furigana, exact source,
  lexical near-copy, semantic near-copy, and cosmetic noun substitution.
- Property tests proving any number of exercises leaves one schedule.
- Scheduling tests proving interval growth is capped until varied evidence exists.
- Offline/cached-exercise and generation-outage E2E tests.

### Exit gate

- Grammar and vocabulary reviews draw from varied validated exercises under one
  schedule per point.
- Exact or near-source material and failed generations cannot enter review.
- Long intervals require materially varied successful contexts.
- Generation failure cannot remove, incorrectly grade, or silently postpone a
  due point.

## Phase 5: Release hardening and controlled rollout

### Purpose

Prove privacy, learning integrity, browser behavior, and operational safety
before enabling automatic media-derived point creation broadly.

### Work packages

- Run the versioned AI evaluation set and human Japanese review across casual
  and polite speech for every promoted prompt/model combination.
- Add structured metrics for recommendation quality, capacity, queue starvation,
  checkout, validation rejection, and varied-context mastery without logging
  source text, generated answers, local filenames, or local media metadata.
- Complete legal review for bounded remote processing of user-supplied subtitle
  excerpts and make consent/deletion behavior explicit.
- Test performance and memory on representative episode-length subtitle tracks
  and browser-WASM media paths.
- Verify Chrome and Firefox behavior, PWA/offline recovery, accessibility,
  keyboard conflicts, and responsive playback UI.
- Roll out in stages: internal fixtures, opt-in development users, limited beta,
  then general availability. Keep a server-side kill switch for AI admission and
  a client feature flag for Watch without disabling ordinary study.
- Confirm the deprecated `jp-player` repository points to Gafu and no active
  deployment or documentation sends users to it.

### Release gate

Every MVP acceptance criterion in the PRD passes in automated or explicitly
documented manual validation. All release-blocking AI invariants pass. Video
locality and source-line exclusion have dedicated negative tests. The latest
migrations have been exercised from a production-shaped backup in a non-production
environment, and rollback/feature-disable procedures are documented.

## Explicitly deferred from this plan

- Multi-episode or season-level recurrence ranking.
- Persistent authentic-audio clip extraction.
- Speech recognition and pronunciation scoring.
- Community or global promotion of personal knowledge points.
- Target selection from media without Japanese subtitles.
- Knowledge-point kinds beyond grammar and vocabulary.

Post-MVP follow-up delivered on 2026-08-29: the optional loopback FFmpeg helper
restores local `jp-player` codec parity without becoming a hosted dependency.
It requires `ffmpeg` on the local machine's `PATH`; browser decoding and manual
timing remain the no-helper fallback. Development enables it automatically;
a production-shaped local run must explicitly set
`GAFU_LOCAL_MEDIA_HELPER=true` and is still restricted to loopback host and
origin checks, plus the backend verifies the TCP peer is loopback. When enabled,
Bun's streaming body ceiling is raised to 64 GiB
so ordinary local video files reach FFmpeg; hosted production retains Bun's
128 MiB default ceiling. The helper stages the upload in an OS-managed,
session-scoped temporary directory so FFmpeg receives seekable input, then
removes that directory on both success and failure.

Deferred work cannot be pulled into an earlier phase merely to simplify an
implementation. If an MVP invariant appears to require it, stop and revise the
product/architecture plan explicitly.

## Requirement traceability

| PRD requirements | Owning phase |
| --- | --- |
| Knowledge lifecycle and one schedule per point | 0, 1 |
| MAT-1 through MAT-6 | 0, 2 |
| SEL-1 through SEL-7 | 1, 2 |
| PRI-1 through PRI-3 | 3 |
| PLY-1 through PLY-4 | 2, 3 |
| CHK-1 and CHK-2 | 3 |
| BNK-1 through BNK-3 | 1, 4 |
| GEN-1 through GEN-5 | 2, 3, 4 |
| REV-1 and REV-2 | 1, 3, 4 |
| Privacy and copyright boundaries | 0, 2, 3, 5 |
| AI evaluation and release gates | 0, 2, 4, 5 |
| `jp-player` consolidation and deprecation | 0, 2, 5 |

## Product decisions required before implementation freezes

These do not block all early work, but each must be resolved before the named
phase exit:

| Decision | Needed by | Safe default for planning |
| --- | --- | --- |
| Grammar/vocabulary mix versus free ranking | Phase 2 | Free ranking with readiness and quality constraints; mix is a soft preference only. |
| Known-vocabulary bootstrap | Phase 1 | Gradual correction first; design an optional import without requiring it for MVP. |
| First-encounter marker default | Phase 3 | Subtle visual marker on, with an obvious global off switch. |
| Mid-episode checkout timing | Phase 3 | Preserve checkout immediately and offer resume/checkout on next visit. |
| Source similarity thresholds | Phase 2 | `source_signature_v1` provisionally uses 0.72 lexical and 0.88 semantic; release remains gated on the versioned evaluation set and Japanese review. |
| Local embedding model and signature storage budget | Phase 2 | Pinned to quantized `Xenova/paraphrase-multilingual-MiniLM-L12-v2` on Transformers.js 2.17.2; persisted semantic cost is 16 bytes per cue plus IndexedDB overhead, while the browser model cache is measured during release hardening. |
| Default review-time budget | Phase 2 | Derive from the existing review-count preference until user research selects a time default. |
| Learner-day time zone | Phase 1 | Store an explicit IANA time zone; do not infer a new zone independently on each device. |
| Browser support floor | Phase 2 | Current stable Chrome and Firefox; fail explicitly for unsupported codecs/APIs. |
| Optional native loopback helper | Resolved 2026-08-29 | Browser decoding remains primary; localhost development may use system FFmpeg, hosted production rejects the route, and manual timing remains available. |

## MVP acceptance evidence

| PRD criterion | Phase | Required evidence |
| --- | --- | --- |
| 1. Zero to three personalized targets | 2 | E2E fixtures for zero, one, and three targets plus known-profile and capacity cases. |
| 2. Primer excludes episode line | 3 | Exact, lexical-near, and semantic-near negative tests before render and TTS. |
| 3. Non-interrupting natural marker | 3 | Browser test asserting no pause, seek, replay, or explanation on cue entry. |
| 4. Source-distinct checkout | 3 | Checkout signature-validation tests for ended and stopped playback. |
| 5. Common point-level SRS | 1, 3 | Database and sync assertions for both kinds under one unique schedule constraint. |
| 6. Two varied contexts before long interval | 4 | Scheduling tests that cap stability/interval until variation evidence qualifies. |
| 7. Source line absent from review bank | 2, 4 | Storage, network, log, TTS, and rendered-output negative tests. |
| 8. Versioned local source comparison | 2 | Exact hash, keyed lexical sketch, embedding, model-mismatch, and unavailable-tool tests. |
| 9. Fresh checkout/next-day priority | 1, 3 | Queue ordering tests and an attendance-versus-starvation metric assertion. |
| 10. Zero-capacity reinforcement | 2 | Concurrent-device and projected-load E2E tests that admit no new point. |
| 11. Playback survives AI failure | 2, 3 | Browser tests with analysis and generation endpoints unavailable. |
| 12. Video remains local | 2, 5 | Network interception tests that fail on any video/audio request to a non-loopback endpoint. |

## Standard validation commands

Run the narrowest relevant tests during each slice, then the full applicable set
at its phase gate:

```sh
pnpm check-types
pnpm test:client
pnpm test:node
pnpm test:browser
pnpm test:e2e
pnpm build
git diff --check
```

Before `jp-player` is deprecated, also establish and preserve its baseline:

```sh
npm test
npm run build
```

Run those two commands in the `jp-player` checkout only; all replacement tests
must pass from Gafu before deprecation.

## Completion definition

The adaptive media MVP is complete only when:

- all six phase exit/release gates pass;
- all twelve MVP acceptance criteria in the PRD have traceable evidence;
- old grammar progress and sync history remain intact;
- Gafu owns and tests every retained player capability;
- `jp-player` is deprecated with no remaining Gafu dependency;
- no video bytes leave the device;
- no source line enters a deliberate learning surface, TTS, log, or synced raw
  text field; and
- known limitations and deferred PRD items are documented without silently
  weakening an invariant.
