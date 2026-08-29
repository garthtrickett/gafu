import { Effect } from "effect";
import type * as kuromoji from "kuromoji";
import {
  NORMALIZED_CUE_VERSION,
  TARGET_OFFSET_UNIT,
  type NormalizedCue,
  type NormalizedToken,
} from "../../../shared/adaptive-media.ts";

const IS_PUNCTUATION = /^[\s。、！？!?…‥・「」『』（）()［］【】〈〉《》〜ー,.]+$/u;
let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
let tokenizerLoad: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;

const katakanaToHiragana = (value: string): string => value.replace(/[ァ-ヶ]/g, (character) =>
  String.fromCharCode(character.charCodeAt(0) - 0x60));

const beginTokenizerLoad = () => import("kuromoji/build/kuromoji.js").then((module) =>
  new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
    module.default.builder({ dicPath: "/dict/" }).build((error, loaded) => {
      if (error) reject(error);
      else {
        tokenizer = loaded;
        resolve(loaded);
      }
    });
  }));

export const loadJapaneseTokenizer = () => tokenizer
  ? Effect.succeed(tokenizer)
  : Effect.tryPromise({
      try: () => tokenizerLoad ??= beginTokenizerLoad(),
      catch: (cause) => new Error(`Could not load Japanese tokenizer: ${String(cause)}`),
    });

const span = (start: number, end: number) => ({
  start,
  end,
  offsetUnit: TARGET_OFFSET_UNIT,
  normalizationVersion: NORMALIZED_CUE_VERSION,
} as const);

export const tokenizeJapaneseWith = (
  text: string,
  loaded: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
): NormalizedToken[] => {
  const normalized = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const result: NormalizedToken[] = [];
  let documentOffset = 0;
  for (const [lineIndex, line] of lines.entries()) {
    let cursor = 0;
    for (const token of loaded.tokenize(line)) {
      const surface = token.surface_form;
      const found = line.indexOf(surface, cursor);
      const localStart = found >= cursor ? found : cursor;
      const start = documentOffset + localStart;
      const end = start + surface.length;
      cursor = localStart + surface.length;
      result.push({
        surface,
        lemma: token.basic_form && token.basic_form !== "*" ? token.basic_form.normalize("NFKC") : surface,
        reading: token.reading && token.reading !== "*" ? katakanaToHiragana(token.reading) : "",
        partOfSpeech: [token.pos, token.pos_detail_1, token.pos_detail_2, token.pos_detail_3].filter((value) => value && value !== "*"),
        conjugationType: token.conjugated_type && token.conjugated_type !== "*" ? token.conjugated_type : null,
        conjugationForm: token.conjugated_form && token.conjugated_form !== "*" ? token.conjugated_form : null,
        punctuation: IS_PUNCTUATION.test(surface),
        lineBreak: false,
        span: span(start, end),
      });
    }
    documentOffset += line.length;
    if (lineIndex < lines.length - 1) {
      result.push({
        surface: "\n",
        lemma: "\n",
        reading: "",
        partOfSpeech: ["記号", "改行"],
        conjugationType: null,
        conjugationForm: null,
        punctuation: true,
        lineBreak: true,
        span: span(documentOffset, documentOffset + 1),
      });
      documentOffset += 1;
    }
  }
  return result;
};

export const tokenizeJapanese = (text: string) => Effect.map(
  loadJapaneseTokenizer(),
  (loaded) => tokenizeJapaneseWith(text, loaded),
);

export const fallbackTokens = (text: string): NormalizedToken[] => {
  const normalized = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  const matches = normalized.matchAll(/\n|\s+|[。、！？!?…‥・「」『』（）()［］【】〈〉《》〜ー,.]|[^\s。、！？!?…‥・「」『』（）()［］【】〈〉《》〜ー,.]+/gu);
  return [...matches].map((match) => {
    const surface = match[0];
    const start = match.index;
    return {
      surface,
      lemma: surface,
      reading: "",
      partOfSpeech: IS_PUNCTUATION.test(surface) ? ["記号"] : ["未知語"],
      conjugationType: null,
      conjugationForm: null,
      punctuation: IS_PUNCTUATION.test(surface),
      lineBreak: surface === "\n",
      span: span(start, start + surface.length),
    };
  });
};

export const tokenizeJapaneseWithFallback = (text: string) => tokenizeJapanese(text).pipe(
  Effect.catchAll(() => Effect.succeed(fallbackTokens(text))),
);

export const DEFAULT_SUBTITLE_TOKENIZATION_BATCH_SIZE = 20;

export const tokenizeSubtitleCuesCooperatively = (
  cues: readonly NormalizedCue[],
  tokenize: (text: string) => Effect.Effect<readonly NormalizedToken[], Error> = tokenizeJapaneseWithFallback,
  batchSize = DEFAULT_SUBTITLE_TOKENIZATION_BATCH_SIZE,
  yieldToBrowser: Effect.Effect<void> = Effect.sleep("1 millis"),
): Effect.Effect<readonly NormalizedCue[], Error> => Effect.gen(function* () {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const enriched: NormalizedCue[] = [];
  for (let start = 0; start < cues.length; start += safeBatchSize) {
    const batch = cues.slice(start, start + safeBatchSize);
    const tokenized = yield* Effect.forEach(batch, (cue) => Effect.map(
      tokenize(cue.normalizedText),
      (tokens) => ({ ...cue, tokens: [...tokens] }),
    ), { concurrency: 4 });
    enriched.push(...tokenized);
    if (start + safeBatchSize < cues.length) yield* yieldToBrowser;
  }
  return enriched;
});
