# Adaptive media MVP release evidence

Status: engineering-complete for internal rollout. General availability remains
held by the human-Japanese and legal approvals described in the release runbook.

| MVP criterion | Automated evidence |
| --- | --- |
| 1. Zero to three profile-aware targets | `recommendations.test.ts`, `syllabus.test.ts`, `MediaCandidateService.test.ts` |
| 2. Primer excludes episode line | `learning-content.test.ts` exact/lexical/semantic fail-closed tests |
| 3. Natural marker does not interrupt | `WatchView.test.ts` pause/seek/network assertion |
| 4. Checkout uses another sentence | local signature validation plus validated exercise-bank admission |
| 5. Grammar/vocabulary share point SRS | migration 09 rehearsal and candidate lifecycle tests |
| 6. Two varied contexts before long interval | `ExerciseBankService.test.ts` mastery-cap test |
| 7. Source line absent from bank/review | local source gate and bank storage/rejection tests |
| 8. Versioned exact/lexical/semantic comparison | `source-signatures.test.ts`, `learning-content.test.ts` |
| 9. Checkout/next-day priority | `adaptive-scheduling.test.ts`, `sessionSyncStore.test.ts` |
| 10. Zero-capacity adds no debt | admission and recommendation capacity tests |
| 11. Playback survives AI failure | Watch component test and Chrome/Firefox adaptive E2E |
| 12. Video stays local | object-URL component test and E2E request-body interception |

Additional release evidence:

- `AdaptiveMediaEvaluation.test.ts`: versioned synthetic corpus coverage,
  source/recent-copy cases, casual/polite human-review worksheet, and an
  episode-length parsing budget.
- `AdaptiveMediaMetrics.test.ts`: runtime allow-list rejects source-bearing
  structured metric fields.
- `AdaptiveMediaRelease.test.ts`: rollout parsing and server kill switch.
- `09_adaptive_knowledge_points.test.ts`: production-shaped isolated migration
  rehearsal through migration 12.
- Production build: PWA service worker and offline exercise-session persistence.

Known release holds:

- Human Japanese review rows are intentionally `pending_human`; AI output is not
  represented as human approval.
- Legal approval of the configured AI provider's subtitle-excerpt processing is
  external to the repository.
- Browser-WASM FFmpeg audio repair is disabled pending licence approval;
  localhost system-FFmpeg repair, original-audio fallback, and manual/local
  timing remain functional.
