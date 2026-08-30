import { Effect } from "effect";
import type { KnowledgePointKind } from "../../shared/adaptive-media.ts";
import { createLocalStore } from "../storage/LocalStoreFactory.ts";
import { enqueueTransaction } from "../sync/OutboxQueue.ts";

export interface MediaCandidatePreference {
  readonly id: string;
  readonly kind: KnowledgePointKind;
  readonly canonicalKey: string;
  readonly disposition: "not_useful";
  readonly hlc: string;
}

const baseMediaCandidatePreferenceStore = createLocalStore<MediaCandidatePreference>(
  "media_candidate_preferences",
);

export const mediaCandidatePreferenceStore = {
  ...baseMediaCandidatePreferenceStore,

  suppress: (kind: KnowledgePointKind, canonicalKey: string) => Effect.gen(function* () {
    if (!canonicalKey.startsWith(`${kind}:`)) {
      return yield* Effect.fail(new Error("The media preference did not match its knowledge-point kind."));
    }
    const hlc = yield* enqueueTransaction("set_media_candidate_preference", {
      kind,
      canonicalKey,
      disposition: "not_useful",
    }).pipe(Effect.mapError((cause) => cause instanceof Error
      ? cause
      : new Error(`Failed to queue media preference: ${String(cause)}`)));
    yield* baseMediaCandidatePreferenceStore.put({
      id: canonicalKey,
      kind,
      canonicalKey,
      disposition: "not_useful",
      hlc,
    });
  }),
};

export const suppressedMediaCanonicalKeys = (): ReadonlySet<string> => new Set(
  mediaCandidatePreferenceStore.state.peek()
    .filter((preference) => preference.disposition === "not_useful")
    .map((preference) => preference.canonicalKey),
);
