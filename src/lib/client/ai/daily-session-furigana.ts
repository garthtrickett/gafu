import { Effect } from "effect";
import type { NormalizedToken } from "../../shared/adaptive-media.ts";
import {
  DailySessionGenerationSchema,
  type DailySessionGeneration,
  type DailySessionGenerationDraft,
  type FuriganaSegment,
} from "../../server/ai/schema.ts";
import { clientLog } from "../clientLog.ts";
import { tokenizeJapanese } from "../media/adaptive/tokenizer.ts";

const HAS_KANJI = /[\p{Script=Han}々〆ヵヶ]/u;

export type DailySessionTokenizer = (
  sentence: string,
) => Effect.Effect<readonly NormalizedToken[], Error>;

export interface FuriganaBuildResult {
  readonly japaneseSentence: string;
  readonly furigana: readonly FuriganaSegment[];
  readonly usedPlainTextFallback: boolean;
}

const normalizeSentence = (sentence: string): string =>
  sentence.normalize("NFKC").replace(/\r\n?/g, "\n");

const plainTextResult = (sentence: string): FuriganaBuildResult => ({
  japaneseSentence: sentence,
  furigana: [{ kanji: sentence }],
  usedPlainTextFallback: true,
});

const segmentForToken = (
  surface: string,
  reading: string,
): FuriganaSegment => {
  const normalizedReading = reading.trim();
  if (HAS_KANJI.test(surface) && normalizedReading.length > 0) {
    return { kanji: surface, kana: normalizedReading };
  }

  return { kanji: surface };
};

/**
 * Builds a lossless full-sentence display sequence from tokenizer spans.
 * Gaps such as whitespace are preserved as plain segments. Any malformed or
 * incomplete token stream falls back to one plain segment rather than
 * returning furigana that disagrees with the authoritative sentence.
 */
export const buildDailySessionFurigana = (
  sentence: string,
  tokens: readonly NormalizedToken[],
): FuriganaBuildResult => {
  const normalizedSentence = normalizeSentence(sentence);
  if (tokens.length === 0) {
    return plainTextResult(normalizedSentence);
  }

  const furigana: FuriganaSegment[] = [];
  let cursor = 0;

  for (const token of tokens) {
    const { start, end } = token.span;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < cursor ||
      end <= start ||
      end > normalizedSentence.length ||
      normalizedSentence.slice(start, end) !== token.surface
    ) {
      return plainTextResult(normalizedSentence);
    }

    if (start > cursor) {
      furigana.push({ kanji: normalizedSentence.slice(cursor, start) });
    }

    furigana.push(segmentForToken(token.surface, token.reading));
    cursor = end;
  }

  if (cursor < normalizedSentence.length) {
    furigana.push({ kanji: normalizedSentence.slice(cursor) });
  }

  if (
    furigana.length === 0 ||
    furigana.map((segment) => segment.kanji).join("") !== normalizedSentence
  ) {
    return plainTextResult(normalizedSentence);
  }

  return {
    japaneseSentence: normalizedSentence,
    furigana,
    usedPlainTextFallback: false,
  };
};

export const enrichDailySessionFurigana = (
  draft: DailySessionGenerationDraft,
  tokenizer: DailySessionTokenizer = tokenizeJapanese,
): Effect.Effect<DailySessionGeneration, Error> =>
  Effect.gen(function* () {
    yield* clientLog(
      "info",
      `[DailySessionFurigana] Deriving full-sentence furigana for ${draft.cards.length} cards.`,
    );

    const cards: DailySessionGeneration["cards"][number][] = [];
    for (const draftCard of draft.cards) {
      const normalizedSentence = normalizeSentence(
        draftCard.japanese_sentence,
      );
      const tokenization = yield* Effect.either(tokenizer(normalizedSentence));
      const built =
        tokenization._tag === "Right"
          ? buildDailySessionFurigana(
              normalizedSentence,
              tokenization.right,
            )
          : plainTextResult(normalizedSentence);

      if (tokenization._tag === "Left") {
        yield* clientLog(
          "warn",
          `[DailySessionFurigana] Tokenizer unavailable for grammar point ${draftCard.grammar_point_id}; preserving the complete sentence without readings.`,
          tokenization.left,
        );
      } else if (built.usedPlainTextFallback) {
        yield* clientLog(
          "warn",
          `[DailySessionFurigana] Tokenizer output was incomplete for grammar point ${draftCard.grammar_point_id}; preserving the complete sentence without readings.`,
        );
      } else {
        yield* clientLog(
          "debug",
          `[DailySessionFurigana] Derived ${built.furigana.length} complete segments for grammar point ${draftCard.grammar_point_id}.`,
        );
      }

      cards.push({
        ...draftCard,
        japanese_sentence: built.japaneseSentence,
        furigana: [...built.furigana],
      });
    }

    const parsed = DailySessionGenerationSchema.safeParse({ cards });
    if (!parsed.success) {
      yield* clientLog(
        "error",
        "[DailySessionFurigana] Deterministic furigana enrichment produced an invalid session.",
        parsed.error,
      );
      return yield* Effect.fail(
        new Error("Generated session furigana could not be prepared."),
      );
    }

    yield* clientLog(
      "info",
      `[DailySessionFurigana] Completed deterministic furigana enrichment for ${parsed.data.cards.length} cards.`,
    );
    return parsed.data;
  });
