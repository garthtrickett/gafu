# jp-player migration inventory

**Pinned source:** `garthtrickett/jp-player@08b77c0858d715966ba6281034f625215394f542`

**Destination:** Gafu

`jp-player` is a temporary migration source. Gafu must not depend on it at
runtime, build time, or release time.

## Behavior inventory

| Source | Behavior | Destination | Decision |
| --- | --- | --- | --- |
| `src/subtitles.js` | SRT/ASS/SSA parsing and active-cue lookup | `src/lib/client/media/adaptive/subtitles.ts` | Migrated; IDs now use exact track fingerprint, format, and source ordinal |
| `src/japanese.js` | Kuromoji loading, furigana, fallback tokens | `src/lib/client/media/adaptive/tokenizer.ts` | Migrated with full lemma/POS/conjugation/span metadata |
| `src/media-id.js` | Session media identifier | `src/lib/client/media/adaptive/local-media.ts` | Replaced with versioned cryptographic fingerprints |
| `server/subtitle-alignment.js` | PCM envelope and drift/offset search | `src/lib/client/media/adaptive/alignment.ts` | Migrated pure algorithm to typed arrays |
| `src/subtitle-alignment.js` | Local Vite middleware client | none | Replace with browser-local adapter; never point at hosted Gafu |
| `src/audio-repair.js` | Browser and native audio repair | `src/lib/client/media/adaptive/audio-repair.ts` | Adapter and original-audio fallback migrated; FFmpeg core remains gated |
| `src/main.js` | File, player, clock, controls, subtitle DOM | `src/components/WatchView.ts` plus adaptive media modules | Extracted into Lit/controller modules |
| `src/style.css` | Player presentation | `src/components/WatchView.ts` | Relevant presentation moved into Gafu's design system |
| `test/*.test.js` | Parser and alignment regression tests | `src/lib/client/media/adaptive/*.test.ts` | Ported and extended |

The replacement is now owned by Gafu. `jp-player` is deprecated and must not be
used as a runtime, package, deployment, or documentation dependency. Its README
points maintainers to Gafu and the repository can be made read-only after the
internal release checks and external legal/human-review holds are resolved.

## Dependency and licence inventory

| Package/asset | Declared licence | Migration decision |
| --- | --- | --- |
| `kuromoji` | Apache-2.0 | Added with `public/third-party-licenses/kuromoji-Apache-2.0.txt` |
| Kuromoji dictionary bundled by the package | NAIST/ICOT notice in upstream `NOTICE.md` | Bundled with `public/third-party-licenses/kuromoji-NOTICE.md` |
| `@ffmpeg/ffmpeg` | MIT | Wrapper is eligible, but unusable without an approved core |
| `@ffmpeg/util` | MIT | Eligible with attribution |
| `@ffmpeg/core` | GPL-2.0-or-later | Do not add to Gafu until the owner completes a distribution/licence decision |
| `@fontsource-variable/noto-sans-jp` | OFL-1.1 | Eligible with OFL notice |
| `jp-player` repository source | No repository licence file found | Owner-authored source may be moved by the owner; add an explicit Gafu project licence decision before third-party distribution |

## Parity baseline

At the pinned source commit on 2026-08-28:

```text
npm test       PASS: 6 tests
npm run build  PASS
```

Required parity includes local file loading, supported video/subtitle formats,
timed subtitles, furigana, word spacing, playback controls, repaired-audio clock
ownership, alignment confidence/manual fallback, and graceful codec/dictionary/
alignment failures.

## Deprecation gate

The old repository can be deprecated only after Gafu owns every migrate-classed
behavior and test, Gafu contains required notices, supported parity checks pass,
and a repository-wide search finds no `jp-player` import, URL, package, iframe,
or build dependency. Its README then points to Gafu and the repository becomes
read-only or archived.
