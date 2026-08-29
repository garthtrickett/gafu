# Adaptive Media Learning PRD

**Status:** Draft for implementation planning

**Last updated:** 2026-08-28

**Product:** Gafu, with media capabilities migrated from Yomikata (`jp-player`)

## Product summary

Gafu turns Japanese media the learner already wants to watch into a personalized
lesson. It analyzes the material against the learner's known grammar and
vocabulary, chooses a small number of high-value next targets, teaches those
targets before playback, lets the learner encounter them once in their original
context, and schedules varied retrieval practice until they become stable.

> Learn it before the episode. Hear it once in context. Retrieve it later in new
> contexts.

The central product invariant is that Gafu schedules **knowledge points**, not
sentences. A knowledge point is either a grammar construction or a vocabulary
item. The authentic episode line is a one-time encounter, and later reviews use
different AI-generated material so that success cannot come from memorizing one
sentence.

## Problem

Watching comprehensible Japanese does not reliably produce new learning for a
learner who needs explicit instruction. Unknown language passes too quickly,
there are too many possible things to attend to, and recognizing a subtitle in
one scene can be mistaken for durable knowledge.

Existing solutions tend to fail in one of two ways:

- Passive playback provides exposure without choosing or teaching a target.
- Sentence mining creates a large queue of copied sentences that learners can
  memorize without generalizing the underlying word or grammar.

Gafu already provides explicit, context-first learning and spaced review.
Yomikata already provides local video playback, timed subtitles, furigana,
tokenization, and subtitle alignment. The opportunity is to connect them into a
closed learning loop without turning entertainment into constant interruption.

## Product promise

Gafu watches what the learner chooses to watch, finds the most valuable words
and grammar they are ready to learn, primes them before the episode, helps them
notice those targets in real context, and makes sure they do not forget them.

## Goals

1. Convert selected media into a small, personalized learning syllabus.
2. Explicitly teach targets before their first relevant episode encounter.
3. Schedule newly primed targets for immediate and next-day retrieval, and offer
   them ahead of an old backlog whenever the learner opens Gafu during those
   review windows.
4. Store durable knowledge as grammar or vocabulary points with one SRS schedule
   per point.
5. Test knowledge across varied contexts rather than repeated sentences.
6. Keep video files local and minimize retention of copyrighted subtitle text.
7. Keep daily learning load predictable and automatically reduce new material
   when the learner's review capacity is full.

## Non-goals

- Teaching every unknown item in an episode.
- Translating every subtitle line.
- Treating passive exposure as proof of recall.
- Creating a permanent flashcard for every subtitle cue.
- Uploading or storing the user's video library.
- Allowing an AI-generated analysis to modify the shared curated catalogue
  without validation.
- Replacing normal, uninterrupted watching with mandatory quizzes throughout
  the episode.

## Product principles

### One uncertain thing at a time

A primer or review should isolate one target. New grammar uses vocabulary the
learner already knows; new vocabulary uses grammar the learner already knows.

### Authentic encounter, generative retrieval

Each exact episode sentence receives one system-controlled presentation: its
natural occurrence during playback. It is not shown in the primer, checkout, or
future card flow. Later exercises deliberately change the sentence, situation,
conjugation, register, or modality. A target may occur in several different
episode sentences; that varied natural recurrence is desirable and does not
justify repeating any individual line.

The product does not disable ordinary player controls, so a learner may manually
rewind. However, Gafu never schedules, recommends, or automatically triggers a
repeat of the original line.

### Schedule concepts, not cards

Each knowledge point has one learning schedule. Authentic encounters and
generated exercises are evidence or presentation material beneath that point;
they do not create independent SRS queues.

### Capacity before novelty

New targets are admitted only when Gafu can reserve capacity for their early
reviews. Gafu controls when a review becomes due and where it appears in an
opened session; it cannot guarantee that the learner returns. When capacity is
exhausted, the episode reinforces existing learning points instead of creating
more review debt.

### AI proposes; evidence and validation constrain it

Deterministic parsing establishes what occurs in the material. AI ranks and
teaches candidates but must cite exact cue evidence, map to canonical forms,
and pass validation before a point is created.

## Core definitions

### Knowledge point

The durable unit the learner is trying to remember. It has exactly one kind:

- **Grammar:** a construction such as `〜ておく`, including recognized spoken
  variants such as `〜とく`.
- **Vocabulary:** a lemma and a particular sense, such as `間に合う` meaning
  "to make it in time."

A fixed expression can initially be represented as a vocabulary point with an
expression subtype. A new top-level kind is unnecessary until its learning and
scheduling behavior is demonstrably different.

### Candidate

A possible grammar or vocabulary target detected in the target material but not
yet accepted into the learner's bank.

### Primer

A short explicit lesson completed before playback. It teaches the knowledge
point using generated material that is different from the episode line.

### Authentic encounter

The moment the target occurs naturally during playback. The player can mark the
target subtly, but the exact dialogue line is not reused as a deliberate prompt.

### Exercise

An AI-generated or curated prompt used to retrieve a knowledge point. Exercises
are presentation material, not separately scheduled cards.

### Card bank

The learner-facing collection of knowledge points and their available exercise
material. Adding four exercises for one point does not add four items to the
review queue.

## End-to-end user journey

### 1. Choose material

The learner loads a video and timed Japanese subtitles into the integrated
player. Video remains on the device. Gafu parses the subtitle file into stable
cue identifiers and analyzes vocabulary and grammar candidates.

The default analysis unit is one episode. If subtitles for later episodes are
also available, recurrence across upcoming material may influence ranking, but
future plot text must not be displayed to the learner.

### 2. Build an episode syllabus

Gafu compares detected candidates with the learner's knowledge profile and
daily review capacity. The AI proposes an ordered syllabus, normally containing
three new targets in total across the day, not three per episode.

To make priming pay off promptly, a pre-episode target should first occur in the
episode's early encounter window: the earlier of the first ten playback minutes
or first 40 percent of the episode. A later target requires explicit learner
acceptance and is labelled accordingly. Gafu presents fewer targets when it
cannot find enough strong early candidates.

The syllabus shows only:

- canonical target;
- reading when applicable;
- concise general meaning;
- why it is a good next step;
- expected number and approximate timing of encounters;
- difficulty and confidence.

It must not reveal the exact episode sentence.

The learner can accept, replace, reduce, or reject recommendations and can mark
a recommendation as already known.

### 3. Prime accepted targets

Each accepted target receives a short explicit primer containing:

- form, reading, and intended sense or function;
- formation or conjugation where relevant;
- one simple generated example using known prerequisites;
- audio and furigana;
- one active retrieval check;
- a brief listening mission such as "listen for the contracted form `〜とく`."

The primer must not quote, paraphrase too closely, or play the upcoming episode
line. Completing the primer creates or activates the knowledge point with state
`primed`. It is immediately protected by the priority review lane even if the
episode is abandoned.

### 4. Watch normally

Playback remains entertainment-first. When a target appears, the subtitle can
receive a subtle, non-spoiling marker. Gafu records that the planned encounter
was reached but does not interrupt playback, reveal an explanation, replay the
line, or count passive exposure as successful recall.

The marker should communicate recognition rather than disclose an answer. Its
default behavior is visual only, with an option to disable all markers.

### 5. Complete the episode checkout

At the end of the episode, or when the learner stops, Gafu tests each primed
target with a fresh generated context. The exact episode sentence and audio are
not used.

The learner can grade or classify each point as:

- recalled;
- not recalled;
- already known;
- wrongly analyzed;
- not useful.

Recalled and missed points both enter normal learning, with a shorter interval
after failure. Already-known points update the learner profile. Wrongly analyzed
candidate or encounter evidence is quarantined from future generation pending
correction; a shared curated point is not globally changed by one report.
Not-useful items are archived for that learner without polluting the active
queue.

### 6. Review through Gafu

When a knowledge point becomes due, Gafu selects one suitable exercise from its
bank or generates a new one. The exercise changes context and surface form while
isolating the same target.

The original episode sentence is never placed in the exercise bank. The system
retains the device-local, non-displayable `source_signature_v1` described below
to prevent accidental exact or near-exact reuse.

### 7. Re-encounter in later media

Later occurrences can be marked as natural re-encounters. Passive occurrence is
useful analytics but does not change SRS stability. If the learner explicitly
performs retrieval before revealing the subtitle, that event may be graded as a
review of the existing knowledge point.

## Knowledge lifecycle

```text
media candidate (no knowledge point and no schedule yet)
    ↓ accepted, canonicalized, and linked to a new or existing point
introduced
    ↓ primer retrieval completed
primed
    ↓ planned cue reached
encountered
    ↓ checkout completed
learning
    ↓ sufficient varied retrieval evidence
stable
```

These labels belong to separate records and must not be collapsed into one
status column:

- A **media candidate** is an analysis result. Its disposition is pending,
  accepted, rejected, already known, not useful, or wrongly analyzed. It is not
  itself a scheduled knowledge point.
- A **knowledge point** is a canonical definition. Its catalogue status is
  active, archived, or quarantined. Quarantining a personal point prevents that
  definition from generating exercises; one learner's report must not
  quarantine a shared curated point globally.
- **Learner progress** owns `introduced`, `primed`, `encountered`, `learning`,
  `stable`, and `known`, plus a user-scoped active or archived participation
  status. This is the only record that owns the SRS schedule.

Alternative transitions and dispositions:

- Marking a candidate already known resolves its canonical point and creates or
  updates learner progress as `known`; it does not create a primer.
- Rejecting a candidate or marking it not useful before acceptance creates no
  knowledge point or schedule.
- Marking an introduced point not useful archives that learner's participation
  and removes it from the active queue without archiving a curated definition.
- `primed → learning` when the episode is abandoned; its review remains due.
- A wrongly analyzed candidate or encounter is quarantined as analysis
  evidence. A personal knowledge point is quarantined only when its canonical
  definition is itself invalid.

No transition from `encountered` to `stable` is allowed based only on passive
exposure.

## Personalized target selection

### Learner profile inputs

Selection uses explicit Gafu state, not assumptions based on what is absent:

- known, learning, and unstable grammar points;
- known, learning, and unstable vocabulary senses;
- difficulty and stability;
- recent successes and failures;
- grammar prerequisites;
- recognition modality when available: text, listening, or production;
- user exclusions and "not useful" history;
- remaining daily learning capacity.

The vocabulary profile must use canonical lemma, reading, and sense. A spelling
alone is not sufficient because one Japanese word may have materially different
meanings.

### Material preprocessing

Before AI ranking, local deterministic processing should:

1. Parse subtitles into stable cue IDs, immutable source timestamps, effective
   aligned timestamps, and normalized text.
2. Tokenize vocabulary into cue-relative target spans, surface form, lemma,
   reading, part of speech, conjugation type, and conjugation form where
   available.
3. Match unambiguous vocabulary against a dictionary.
4. Count occurrences and surface-form diversity.
5. Remove punctuation, names, obvious noise, and already-known items.
6. Detect or shortlist possible grammar spans.
7. Calculate first occurrence and recurrence within the episode.
8. Produce a bounded candidate set for AI analysis.

Yomikata currently returns only surface form, reading, punctuation, and line
break metadata even though Kuromoji produces additional fields. Before
integration, its tokenizer contract must retain the lemma (`basic_form`), full
part-of-speech hierarchy, conjugation type and form, and cue-relative start/end
offsets in the normalized cue text. The contract must declare its text
normalization and offset-unit version so evidence spans can be reproduced.
Yomikata supplies lexical evidence; Gafu remains responsible for mapping that
evidence to a canonical grammar alias or vocabulary lemma-sense point.

### Stable cue identity and aligned timing

The current Yomikata IDs (`srt-<index>` and `ass-<index>`) are session-local
positions and are insufficient for persistent provenance. The extracted parser
must calculate:

- `subtitle_track_fingerprint`: SHA-256 of the exact subtitle-file bytes;
- `source_cue_ordinal`: the record's position in the source file before cues are
  sorted by time; and
- `cue_id`: SHA-256 of the track fingerprint, subtitle format, and source cue
  ordinal.

Loading the same subtitle bytes again therefore produces the same cue IDs. An
edited subtitle file intentionally produces a new track fingerprint and new
IDs. Cue identity must not depend on text cleanup, automatic alignment, manual
offset, or playback order.

Each cue retains immutable source start/end timestamps. Automatic drift/offset
alignment and manual adjustment are stored as a separate versioned timing
transform from source time to effective playback time. Encounter provenance
records both the cue ID and the timing-transform version used; changing
alignment never changes cue identity.

### AI ranking criteria

The AI ranks candidates by:

1. readiness based on known prerequisites;
2. general usefulness;
3. recurrence in the current and optionally upcoming material;
4. early first occurrence after priming;
5. contextual clarity and sentence comprehensibility;
6. diversity of observed surface forms;
7. relevance to the learner's goals;
8. estimated learning difficulty;
9. confidence in canonicalization and meaning.

It should penalize proper names, one-off plot nouns, ambiguous analyses,
redundant synonyms, and examples whose surrounding grammar is mostly unknown.

The ranking objective is not "most frequent unknown token." It is the best
combination of future payoff, readiness, contextual support, and manageable
review cost.

### Required AI recommendation output

Every proposed target must provide structured fields for:

- kind: grammar or vocabulary;
- canonical form or lemma;
- reading for vocabulary;
- intended meaning or function;
- observed surface forms;
- exact internal cue IDs and target spans as evidence;
- count and first encounter time;
- known prerequisite IDs;
- existing Gafu catalogue match, if any;
- why this target is appropriate now;
- confidence;
- proposed review-cost class.

Evidence text is available to validators but the user-facing syllabus must not
display the original cue.

### Validation and deduplication

Before presentation, Gafu must:

- verify that every evidence cue and target span exists;
- validate vocabulary lemma and reading against the tokenizer/dictionary;
- resolve conjugated forms and grammar aliases to canonical points;
- attach to an existing point instead of creating a duplicate;
- reject a proposed known point unless the AI explicitly recommends
  reinforcement;
- reject low-confidence grammar proposals or require user confirmation;
- prevent AI output from writing directly to the shared curated catalogue.

New discoveries begin as personal points. They may later merge with a curated
point or be promoted through a separate editorial process.

### Failure and fallback behavior

- If AI analysis fails, playback remains available without a syllabus.
- If only one good candidate exists, Gafu proposes one rather than filling a
  quota with weak targets.
- If grammar confidence is low, Gafu can offer the candidate for manual
  confirmation or choose vocabulary instead.
- If no new targets fit capacity, Gafu generates a reinforcement syllabus from
  learning points already present in the episode.

## Daily capacity and backlog prevention

### Defaults

- Default new-target allowance: **3 per day**.
- Typical mix: **1 grammar point and 2 vocabulary points**.
- Hard maximum: **5 new targets per day**, regardless of episode count.
- Default maximum unstable recent pool: **20 knowledge points**.
- Grammar and difficult vocabulary receive a higher projected review cost than
  straightforward vocabulary.

These are starting product safeguards, not claims of universal cognitive limits.
The system should adapt downward or upward from observed workload and recall,
within the hard maximum.

### Admission control

Before priming a target, Gafu estimates its reviews over the next seven days and
compares that cost with:

- already scheduled reviews;
- the user's daily review limit;
- a failure buffer;
- recent completion rate;
- current unstable-pool size.

New targets are reduced or disabled when projected capacity cannot reserve both
an immediate checkout slot and a next-day review slot. A reserved slot means the
point is due and receives queue priority if the learner opens Gafu; it is not a
claim that the learner will attend.

Suggested policy:

- Healthy queue and recall: admit up to 3 targets.
- Light projected load with sustained high completion: offer, but never
  automatically impose, up to 5.
- Moderate projected load: admit 1–2.
- Unhealthy queue, missed reviews, or full unstable pool: admit 0.

### Queue priority

The review queue is not FIFO. It reserves priority in this order:

1. checkout for targets primed today;
2. primed and learning points introduced within the last seven days;
3. normally due mature points;
4. overdue lower-risk mature points.

An old mature backlog cannot push a newly primed point out of its consolidation
window. Conversely, the existence of that backlog can block admission of more
new targets.

### Reinforcement mode

When no new capacity exists, the AI searches the episode for current learning
points and creates a reinforcement mission. This preserves purposeful viewing
without increasing review debt.

## Grammar and vocabulary knowledge points

### Shared properties

Both kinds share:

- one canonical identity;
- curated or personal scope;
- catalogue status and a separate user-scoped learner state;
- one user-specific SRS schedule;
- difficulty and stability;
- encounter and review history;
- generated-exercise history;
- source and confidence metadata;
- archival and quarantine behavior.

### Grammar details

A grammar point can include:

- canonical form;
- base meaning and pragmatic function;
- formation rules;
- spoken and written aliases;
- register;
- prerequisites;
- common confusions;
- observed conjugated forms.

Mastery requires retrieval across different vocabulary, situations, and surface
forms.

### Vocabulary details

A vocabulary point can include:

- lemma;
- reading;
- part of speech;
- intended sense;
- common inflections;
- register;
- common collocations;
- homograph or sense disambiguation.

Mastery applies to a lemma-sense pair rather than every possible meaning of the
same spelling.

## AI-generated exercise system

### Generation contract

The generator receives:

- target knowledge-point ID and details;
- allowed stable grammar and vocabulary;
- recent exercise fingerprints and variation history;
- performance weaknesses;
- desired modality and difficulty;
- source-exclusion policy version; the device-local source signature and its key
  are not sent to the generator;
- target locale and natural-spoken-language requirements.

It returns structured exercise data containing:

- target ID;
- situational context;
- Japanese sentence;
- target surface span;
- answer and explanation;
- furigana;
- modality;
- conjugation, register, and variation tags;
- prerequisites used;
- generation confidence.

### Required variation

Across reviews, Gafu deliberately varies:

- situation;
- surrounding vocabulary;
- tense and conjugation;
- politeness and register;
- speaker intention;
- recognition versus production;
- text-first versus ear-first presentation;
- positive, negative, and question forms when appropriate.

The generator must not create superficial noun substitutions that preserve the
same sentence frame indefinitely.

### Source-line exclusion

The exact episode sentence:

- is not used in the primer;
- appears naturally during playback only;
- is not used in checkout;
- is not stored in the exercise bank;
- is not synthesized with TTS;
- is not intentionally regenerated later;
- is represented locally by an exact normalized hash plus a non-displayable
  lexical/semantic similarity signature sufficient to reject exact or
  near-exact generated duplicates.

Temporary access to the cue text is allowed only while analyzing the local
subtitle or checking similarity. Device-local persistent storage should contain
the minimum metadata needed for provenance and deduplication. Similarity
signatures must not be rendered back to the learner or sent in logs.

The MVP uses a versioned, device-local `source_signature_v1` rather than an
unspecified semantic fingerprint:

1. Normalize the sentence with Unicode NFKC, standardized whitespace, and the
   same versioned Japanese tokenizer used for candidate evidence.
2. Store a SHA-256 hash of the normalized sentence for exact-match rejection.
3. Build a 32-entry bottom-k lexical sketch from lemma/primary-POS uni-, bi-,
   and trigrams. Hash every shingle with HMAC-SHA-256 under a random 32-byte
   device-local key, then discard the shingles. The key stays in a private
   IndexedDB store and is never logged or synced.
4. Build a mean-pooled, normalized embedding locally with quantized
   `Xenova/paraphrase-multilingual-MiniLM-L12-v2` under Transformers.js 2.17.2.
   Compress it immediately to a deterministic 128-bit random-hyperplane SimHash
   and discard the raw embedding. Record the model and normalization versions.
5. For every generated sentence, compute the same values locally. Reject exact
   hashes, lexical scores at or above 0.72, and semantic Hamming-agreement scores
   at or above 0.88. These thresholds belong to `source_signature_v1` and remain
   provisional until the versioned evaluation corpus and Japanese human review
   justify promotion. Missing source signatures, model failure, or a model/
   normalization version mismatch means validation unavailable and fails closed.
   Threshold promotion is established by the release evaluation set.

The signature, model inputs, and device key are not learner-visible, do not
enter application logs, and do not sync by default. The server may return a
generated candidate, but the client performs the final source-reuse check before
the exercise can become learner-facing. If a signature cannot be evaluated
because its tokenizer or embedding model is unavailable or incompatible, the
candidate remains unvalidated and cannot enter the exercise bank. A previously
validated cached exercise may still be used.

### Exercise validation

Generated exercises are rejected when:

- the target is absent or used with the wrong sense/function;
- the answer is ambiguous;
- success requires another unknown item;
- the Japanese is unnatural or mismatched to the requested register;
- it duplicates the source or a recent exercise;
- target-span, furigana, or reading data does not match the sentence;
- the exercise tests trivia about the context instead of the knowledge point.

Validation should combine deterministic checks with AI critique where necessary.
Rejected generations never enter the learner-facing bank.

### Mastery evidence

One remembered sentence cannot produce high stability. Interval growth should be
limited until the learner succeeds in at least two materially different contexts.
Where practical, stable status should include evidence across more than one
surface form or modality.

## Conceptual data model

This section describes product entities rather than committing to exact table
names or migration structure.

### Media candidate

```text
id
analysis_run_id
kind: grammar | vocabulary
proposed canonical identity and sense/function
evidence cue IDs and target spans
confidence
disposition: pending | accepted | rejected | already_known | not_useful |
             wrongly_analyzed
resolved_knowledge_point_id, when accepted or already known
```

A candidate has no review schedule. Acceptance or an already-known correction
must first resolve it to exactly one canonical knowledge point.

### Knowledge point

```text
id
kind: grammar | vocabulary
canonical_key
scope: curated | personal
catalogue_status: active | archived | quarantined
created_from: catalogue | media | manual
confidence
```

Catalogue status describes whether the definition itself is usable. It is not a
learner's mastery state and is not changed globally by a learner archiving or
reporting one occurrence.

### Grammar details

```text
knowledge_point_id
canonical_form
base_meaning
formation
aliases
register
prerequisite_ids
```

### Vocabulary details

```text
knowledge_point_id
lemma
reading
part_of_speech
sense_key
meaning
register
```

### Learner progress

```text
user_id
knowledge_point_id
participation_status: active | archived
learning_state: introduced | primed | encountered | learning | stable | known
difficulty
stability
next_review
last_reviewed_at
introduced_at
```

### Media encounter

```text
user_id
knowledge_point_id
media_fingerprint
subtitle_track_fingerprint
user-visible source label
cue_id
source cue start/end
timing transform ID/version
effective playback start/end at encounter
target surface form
source signature version
device-local source signature reference
encountered_at
```

Raw subtitle text is ephemeral by default and is not required in the persistent
encounter record. Device-local source-exclusion storage contains the versioned
exact hash, keyed lexical sketch, and local embedding described above; none is a
renderable copy of the line. Synced encounter provenance need not contain the
device-local lexical sketch, embedding, or key.

### Exercise

```text
id
knowledge_point_id
prompt and answer data
generated sentence fingerprint and signature version
variation tags
prerequisite IDs
validation status
generation metadata
```

### Review event

```text
user_id
knowledge_point_id
exercise_id
result
response time
reviewed_at
scheduling change
```

### Migration from the current Gafu schema

Gafu currently models canonical content in `grammar_point`, and each `srs_card`
has a required `grammar_point_id` with a unique `(user_id, grammar_point_id)`
schedule. Phase 1 must migrate this rather than layering vocabulary beside the
grammar-only foreign key:

1. Create the shared knowledge-point identity plus grammar and vocabulary detail
   records.
2. Backfill every existing grammar point into a grammar knowledge point,
   preserving identifiers where possible or retaining an explicit mapping.
3. Replace `srs_card.grammar_point_id` with `knowledge_point_id`, preserve all
   existing ease, repetition, interval, difficulty, stability, review-date, HLC,
   and user ownership data, and enforce one unique `(user_id,
   knowledge_point_id)` scheduling row.
4. Migrate server sync contracts, generated database types, client stores,
   seed/restore utilities, and tests in the same compatibility plan so no path
   can create a grammar-only or sentence-level sibling schedule.
5. Add vocabulary lemma-sense details only after the shared identity and
   scheduling invariant are in place.

## Functional requirements

### Material and analysis

- **MAT-1:** The player accepts the existing supported video and subtitle formats.
- **MAT-2:** Video stays local and remains playable if syllabus generation fails.
- **MAT-3:** Every parsed subtitle cue has an ID namespaced by the exact subtitle
  track fingerprint and source-record ordinal, plus immutable source timestamps.
- **MAT-4:** Vocabulary candidates preserve normalized-text target offsets,
  surface form, lemma, reading, part-of-speech hierarchy, conjugation type, and
  conjugation form.
- **MAT-5:** Analysis can identify repeated occurrences without persisting the
  full subtitle transcript.
- **MAT-6:** Alignment and manual timing adjustments are versioned transforms;
  they change effective playback time without changing cue identity or source
  timestamps.

### Selection

- **SEL-1:** Recommendations use explicit known and learning grammar/vocabulary.
- **SEL-2:** Every recommendation cites valid internal cue evidence.
- **SEL-3:** The system recommends fewer targets rather than low-quality filler.
- **SEL-4:** Recommendations respect the global daily admission limit.
- **SEL-5:** Existing points are reused through canonical matching and aliases.
- **SEL-6:** The syllabus does not expose exact upcoming episode dialogue.
- **SEL-7:** Pre-episode targets occur inside the early encounter window unless
  the learner explicitly accepts a target labelled as occurring later.

### Priming and playback

- **PRI-1:** Every accepted target receives explicit instruction and retrieval.
- **PRI-2:** Primer examples differ materially from the episode sentence.
- **PRI-3:** Primed points are protected by the priority queue immediately.
- **PLY-1:** Target markers do not pause or replay playback automatically.
- **PLY-2:** Passive encounter does not update recall stability.
- **PLY-3:** Markers can be disabled.
- **PLY-4:** Gafu presents each exact source cue only at its natural playback
  occurrence; primer, checkout, explanation, and review never present it again.

### Checkout and bank

- **CHK-1:** Checkout uses a fresh context rather than the episode sentence.
- **CHK-2:** Checkout remains available when playback stops before episode end.
- **BNK-1:** A knowledge point has exactly one user scheduling record.
- **BNK-2:** Multiple exercises do not create multiple scheduled siblings.
- **BNK-3:** Grammar and vocabulary points share scheduling infrastructure while
  retaining kind-specific teaching data.

### Generation and review

- **GEN-1:** New grammar exercises use stable vocabulary wherever possible.
- **GEN-2:** New vocabulary exercises use stable grammar wherever possible.
- **GEN-3:** Exact and near-exact source-sentence reuse is rejected locally using
  the versioned exact hash, keyed lexical sketch, and embedding comparison.
- **GEN-4:** Recent exercise repetition is rejected or deprioritized.
- **GEN-5:** Failed validation cannot add learner-facing exercises.
- **REV-1:** High stability requires success in multiple distinct contexts.
- **REV-2:** Newly primed points cannot be starved by mature overdue cards.

## Privacy, copyright, and data boundaries

- Video files never leave the device.
- Subtitle parsing and deterministic lexical preprocessing run locally.
- AI analysis may receive the minimum necessary subtitle excerpts or bounded
  candidate context only with clear user consent.
- Whole videos, audio tracks, and full subtitle archives are not stored by Gafu.
- Selected episode lines are transient analysis inputs, not permanent cards.
- Persistent encounter provenance uses timestamps, source labels, target forms,
  and cue/track fingerprints by default rather than raw dialogue.
- Source-exclusion lexical sketches, embeddings, and their device key remain
  device-local by default. They are not rendered, logged, or automatically
  synced.
- Server logs must not include subtitle text, generated answers, local filenames,
  or video metadata beyond non-reversible operational identifiers.
- Deleting a media-derived personal point deletes its encounter provenance and
  generated exercises according to the normal sync model.

The exact legal requirements for remotely processing user-supplied subtitles
must be reviewed before commercial release. The MVP should minimize transmitted
and retained content regardless of legal conclusion.

## UX and failure states

- Analysis shows progress without blocking basic playback.
- The learner can start watching without accepting any targets.
- If a recommendation is wrong, one action marks it wrong and prevents its
  exercises from entering review.
- If a target is already known, the correction immediately improves the profile.
- If the episode is abandoned after priming, those points remain visible and due;
  they do not disappear because their expected cue was not reached.
- If generated cards are temporarily unavailable, due points remain due and can
  use a validated cached exercise that is not the source sentence.
- If the daily queue is unhealthy, Gafu clearly explains why it is offering
  reinforcement rather than new targets.

## Integration direction

Gafu should become the application shell with a Watch area powered by media
modules migrated from Yomikata. An iframe would complicate learner state,
keyboard handling, persistence, and styling.

Yomikata is not a Chrome extension and Gafu does not call it as a remote
service. Its reusable modules are compiled into Gafu's browser application. The
learner selects local video and subtitle files in the Watch area, and the
browser retains ownership of those `File` objects for the session.

The `jp-player` repository is a migration source, not a permanent package
dependency. Relevant source, tests, browser assets, and attribution are moved
into Gafu, verified there, and thereafter maintained only in Gafu. Once parity
and the Gafu Watch smoke tests pass, `jp-player` is marked deprecated and made
read-only or archived with a pointer to Gafu. Deprecation happens only after
Gafu no longer imports, fetches, or builds anything from that repository.

The current Yomikata implementation centralizes file loading, playback state,
subtitle rendering, tokenization calls, timing, and DOM events in `src/main.js`.
Integration therefore begins with a behavior-preserving extraction into
framework-neutral modules rather than importing the standalone page:

- a pure subtitle parser that returns stable cue records;
- a tokenizer that returns the full normalized token/evidence contract;
- a playback controller that exposes the active clock and emits cue-entered,
  cue-left, stopped, and ended events;
- audio repair and subtitle-alignment adapters; and
- a thin Gafu Lit view/controller that renders player state and turns player
  events into Gafu encounter actions.

The boundary is an in-process typed module API, not HTTP. It exposes parsed
cues, normalized token metadata, playback time, timing-transform changes, and
encounter events. It never transfers ownership of the video `File` to Gafu's
remote server.

Yomikata's current `/api/repair-audio`, `/api/analyze-audio`, and
`/api/align-subtitles` routes are local Vite middleware backed by local FFmpeg;
they are not suitable as hosted Gafu endpoints because posting to them remotely
would upload the video. Hosted Gafu must use browser/WASM processing. A native
path may use an explicitly installed loopback-only helper, but absence of
that helper must leave original playback and manual subtitle offset available.
The optional native path is now implemented for localhost development: the
browser tries its decoder first, then may stream the file to the same-machine
Gafu process for system-FFmpeg analysis. The route is disabled in hosted
production, rejects non-loopback requests, and is never called by a non-loopback
browser page. Absence of FFmpeg still leaves original playback and manual
subtitle offset available. It must never cause a remote upload or make playback
depend on alignment.

The media modules migrated into Gafu remain responsible for:

- local video and subtitle loading;
- subtitle parsing and active-cue timing;
- local tokenization and furigana;
- audio repair and subtitle alignment;
- playback controls.

Gafu remains responsible for:

- authenticated learner profile and sync;
- grammar and vocabulary knowledge points;
- daily capacity and SRS scheduling;
- AI selection, priming, and exercise generation;
- checkout, review, and mastery evidence.

Canonical candidate matching and all durable learner-state mutations occur on
the Gafu side of this boundary.

## Success metrics

### Primary learning outcome

- Seven-day recall of media-derived knowledge points in a sentence that was not
  used in the primer or episode.

### Supporting outcomes

- Next-day recall rate for primed targets.
- Recall across two or more distinct contexts.
- Percentage of selected targets naturally encountered as predicted.
- Time from completed primer to first authentic target encounter.
- Percentage of media-derived points that reach stable status.
- Text versus listening recognition where measured.

### Queue health guardrails

- Daily review completion rate.
- Number and age of overdue points.
- Size of the unstable recent pool.
- Projected seven-day review load.
- Percentage of next-day windows in which the learner returns and the fresh
  primed point is offered before mature backlog.
- Learner completion rate for next-day reviews, reported separately from queue
  ordering failures.
- Average review-session duration.

The application-controlled fresh-point starvation rate should be effectively
zero: among review sessions opened while a newly primed point is due, measure
the percentage in which an eligible fresh point was not offered before mature
backlog. Days on which the learner does not open Gafu are missed attendance, not
queue starvation. Target volume must not be increased merely to improve
syllabus acceptance or point-creation metrics.

### AI quality guardrails

- Recommendation rejection and replacement rate.
- Incorrect canonicalization rate.
- Duplicate-point creation rate.
- Generated-exercise validation failure rate.
- Source or recent-sentence similarity rejection rate.
- "Already knew this" recommendation rate.
- User-reported unnatural or incorrect Japanese.

## Risks and mitigations

### Incomplete learner profile

**Risk:** Gafu recommends many words the learner already knows or generates a
grammar lesson containing unknown vocabulary.

**Mitigation:** Bootstrap vocabulary through a combination of optional import,
small placement samples, and rapid "already know this" corrections. Treat
missing profile data as unknown confidence, not proof that an item is unknown.

### AI misidentifies grammar or word sense

**Risk:** A confident but incorrect point enters long-term review.

**Mitigation:** Require evidence spans, deterministic vocabulary checks,
catalogue/alias resolution, confidence thresholds, one-action user correction,
and quarantine. Personal AI discoveries never write directly to the shared
catalogue.

### Quota pressure lowers target quality

**Risk:** The AI fills three slots even when the episode has only one suitable
target.

**Mitigation:** Target count is a ceiling, not a quota. Fewer new points or a
reinforcement syllabus is a successful result.

### Priming becomes a spoiler

**Risk:** Examples or syllabus explanations reveal upcoming dialogue or plot.

**Mitigation:** Show canonical form, general meaning, encounter count, and broad
timing only. Generate primer contexts independently and validate similarity
against source signatures.

### Generated variation is cosmetic

**Risk:** Exercises replace nouns while preserving an easily memorized frame.

**Mitigation:** Track situation, syntax, conjugation, register, and modality;
require material variation before stability can grow; reject high similarity to
source and recent exercises.

### Review debt accumulates silently

**Risk:** Media consumption creates new points faster than the learner can
consolidate them.

**Mitigation:** Global admission control, projected seven-day cost, protected
fresh-review lanes, an unstable-pool cap, and zero-new reinforcement mode.

### Target markers damage the viewing experience

**Risk:** The learner watches for UI effects rather than following the scene.

**Mitigation:** Markers are subtle, optional, non-interrupting, and do not reveal
an explanation. Measure marker disablement and viewing abandonment.

### Source dialogue is retained or resurfaced

**Risk:** Copyrighted text becomes a permanent card or the exact line is shown
often enough to be memorized.

**Mitigation:** Raw cue text is transient, exact dialogue is excluded from every
deliberate learning surface, persistent provenance uses local non-displayable
signatures, and source-reuse checks are release-blocking.

## AI evaluation and release gates

Before enabling automatic point creation, maintain a versioned evaluation set
containing representative subtitle cues, learner profiles, expected canonical
matches, deliberate ambiguity, contractions, inflections, names, and malformed
subtitles.

The following are release-blocking invariants:

- every recommended evidence span exists in its cited cue;
- every vocabulary recommendation passes lemma and reading validation;
- no known point is presented as new after canonical alias resolution;
- no exact source sentence is accepted as a primer or exercise;
- a source-distinct exercise is not accepted unless the client can evaluate a
  compatible version of the source signature;
- no failed or quarantined generation reaches review;
- each accepted exercise identifies exactly one scheduled target;
- adding exercises does not increase the number of scheduling records;
- capacity calculations never admit more than the global daily limit;
- a zero-capacity profile receives reinforcement or no syllabus, never new debt.

Human evaluation remains necessary for naturalness, pragmatic meaning, grammar
function, sense selection, and whether generated contexts are materially varied.
Samples should be reviewed across casual and polite speech before each material
model or prompt change is promoted.

Production monitoring must use structured IDs, outcomes, and confidence rather
than logging raw source dialogue.

## MVP scope

### Phase 1: Knowledge foundation

- Introduce a shared knowledge-point abstraction for grammar and vocabulary.
- Backfill existing `grammar_point` rows and migrate `srs_card` from
  `grammar_point_id` to a unique per-user `knowledge_point_id` without losing
  review or sync state.
- Add vocabulary lemma-sense progress.
- Preserve existing grammar progress during migration.
- Schedule one queue entry per point.
- Record generated exercise history and fingerprints.

### Phase 2: Episode syllabus

- Extract Yomikata's parser, tokenizer, playback clock, timing transforms, and
  encounter events from its standalone page into browser modules consumed by
  Gafu's Watch area.
- Replace positional cue IDs and truncated surface/reading tokens with the
  stable cue identity and full normalized token contracts.
- Compare episode candidates with the learner profile.
- Add AI ranking with evidence and validation.
- Enforce a global daily target allowance and reinforcement fallback.
- Present an accept/replace/reject syllabus without source-line spoilers.

### Phase 3: Prime, encounter, checkout

- Generate source-distinct primers.
- Add subtle optional target markers during playback.
- Record provenance without raw persistent subtitle lines.
- Generate source-distinct checkout exercises.
- Activate point-level scheduling and protected early reviews.

### Phase 4: Generative review bank

- Generate and validate varied exercise packs.
- Select exercises using recent context, form, and modality history.
- Limit stability growth until varied-context evidence exists.
- Replenish exercise material without adding schedule entries.

### Deferred

- Multi-episode and season-level recurrence ranking.
- Persistent extraction of authentic audio clips.
- Speech recognition and pronunciation scoring.
- Community or global promotion of personal points.
- Automatic target selection from media without Japanese subtitles.
- Additional knowledge-point kinds beyond grammar and vocabulary.

## MVP acceptance criteria

The first complete version is successful when:

1. A learner can load an episode and receive zero to three validated targets
   chosen from its subtitles and their current knowledge profile.
2. The learner can prime each target without seeing or hearing its episode line.
3. The player can mark the target's natural occurrence without interruption or
   automatic replay.
4. Checkout tests the point with a different sentence.
5. Accepted grammar and vocabulary targets enter one common point-level SRS flow.
6. At least two materially different generated contexts are required before a
   point can gain a long interval.
7. The original episode line never appears in the card bank or generated review.
8. A versioned exact hash, keyed lexical sketch, and local embedding comparison
   reject exact and near-exact source reuse without persistently storing raw
   source text.
9. Newly primed targets are scheduled for checkout and next-day review and,
   whenever the learner opens an eligible review session, are offered before
   the mature backlog.
10. When capacity is exhausted, the system offers reinforcement targets and adds
    no new review debt.
11. Playback works when AI analysis or exercise generation is unavailable.
12. Video data remains local throughout the flow.

## Resolved product decisions

- Knowledge points can be grammar or vocabulary.
- Vocabulary identity is lemma plus sense, not spelling alone.
- The AI selects next targets using both known grammar and known vocabulary.
- The normal default is three new targets per day, with a global hard maximum of
  five and adaptive reduction under load.
- Priming happens before playback with a different example.
- Each exact episode line receives one natural system-controlled presentation;
  Gafu does not deliberately repeat it before or after that moment.
- Checkout and future review use new contexts.
- The card bank stores one schedule per knowledge point, not one schedule per
  generated sentence.
- Passive exposure does not count as retrieval.
- A backlog blocks new admissions but cannot starve a point that was already
  primed.
- Yomikata is integrated as browser modules inside Gafu's Watch area, not as a
  Chrome extension, iframe, or remote player API.
- The relevant `jp-player` implementation and tests move into Gafu; Gafu has no
  runtime or build dependency on `jp-player` before that repository is
  deprecated.

## Open product questions

1. Should the default syllabus always balance grammar and vocabulary, or should
   ranking freely choose all of one kind when the material strongly favors it?
2. How should a learner bootstrap their known-vocabulary profile: import,
   placement sampling, gradual correction, or a combination?
3. Should the player show target highlighting on first encounter by default, or
   require the learner to identify it before revealing the marker?
4. What lexical-sketch and embedding thresholds on the versioned evaluation set
   best reject AI-generated near-copies without rejecting legitimately varied
   examples?
5. Should stopping mid-episode trigger checkout immediately or offer it on the
   next app visit?
6. What review-time budget should be the default alongside the existing
   review-count preference?
