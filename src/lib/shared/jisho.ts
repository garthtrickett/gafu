// File: src/lib/shared/jisho.ts
// ------------------------------------------------------------------------------
// Wire contract for Jisho.org dictionary lookups.
// ------------------------------------------------------------------------------
// The browser cannot call jisho.org directly (it serves no CORS headers), so the
// lookup is proxied by /api/jisho/search. Both sides of that proxy agree on the
// shapes and the pure helpers below, which keeps term validation identical in the
// component that raises a lookup and the route that performs it.

export interface JishoForm {
  readonly word: string | null;
  readonly reading: string | null;
}

export interface JishoSense {
  readonly englishDefinitions: readonly string[];
  readonly partsOfSpeech: readonly string[];
  readonly tags: readonly string[];
  readonly seeAlso: readonly string[];
}

export interface JishoEntry {
  readonly slug: string;
  readonly isCommon: boolean;
  readonly jlpt: readonly string[];
  readonly forms: readonly JishoForm[];
  readonly senses: readonly JishoSense[];
}

export interface JishoLookupResult {
  readonly term: string;
  readonly entries: readonly JishoEntry[];
}

// A highlighted run longer than this is a sentence, not a word: Jisho would
// return nothing useful and the learner almost certainly mis-dragged.
export const MAX_LOOKUP_TERM_LENGTH = 24;

// Bounded so one lookup cannot flood the modal with Jisho's long tail.
export const MAX_LOOKUP_ENTRIES = 6;
export const MAX_LOOKUP_SENSES = 5;
export const MAX_LOOKUP_DEFINITIONS = 6;

// 々 and 〆 sit inside the CJK punctuation block but are part of real words
// (人々, 〆切), so they are matched as letters rather than stripped as edges.
const JAPANESE_CHARACTER = /[々〆぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/u;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export const extractJapaneseLookupTerm = (raw: string): string | null => {
  // Selections spanning ruby markup arrive with layout whitespace baked in.
  const collapsed = raw.replace(/\s+/gu, "");
  const trimmed = collapsed.replace(EDGE_PUNCTUATION, "");
  if (trimmed.length === 0 || trimmed.length > MAX_LOOKUP_TERM_LENGTH) return null;
  if (!JAPANESE_CHARACTER.test(trimmed)) return null;
  return trimmed;
};

const readStrings = (value: unknown, limit: number): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
};

const readForms = (value: unknown): readonly JishoForm[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((form) => {
      if (typeof form !== "object" || form === null) return null;
      const record = form as { readonly word?: unknown; readonly reading?: unknown };
      const word = typeof record.word === "string" && record.word.length > 0 ? record.word : null;
      const reading = typeof record.reading === "string" && record.reading.length > 0 ? record.reading : null;
      return word === null && reading === null ? null : { word, reading };
    })
    .filter((form): form is JishoForm => form !== null);
};

const readSenses = (value: unknown): readonly JishoSense[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((sense) => {
      if (typeof sense !== "object" || sense === null) return null;
      const record = sense as Record<string, unknown>;
      const englishDefinitions = readStrings(record.english_definitions, MAX_LOOKUP_DEFINITIONS);
      if (englishDefinitions.length === 0) return null;
      return {
        englishDefinitions,
        partsOfSpeech: readStrings(record.parts_of_speech, MAX_LOOKUP_DEFINITIONS),
        tags: readStrings(record.tags, MAX_LOOKUP_DEFINITIONS),
        seeAlso: readStrings(record.see_also, MAX_LOOKUP_DEFINITIONS),
      };
    })
    .filter((sense): sense is JishoSense => sense !== null)
    .slice(0, MAX_LOOKUP_SENSES);
};

// Jisho's payload is an unversioned community API, so every field is treated as
// untrusted and an unreadable entry is dropped rather than failing the lookup.
export const normalizeJishoResponse = (term: string, payload: unknown): JishoLookupResult => {
  const data = typeof payload === "object" && payload !== null && "data" in payload
    ? (payload as { readonly data: unknown }).data
    : null;
  if (!Array.isArray(data)) return { term, entries: [] };

  const entries = data
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const senses = readSenses(record.senses);
      if (senses.length === 0) return null;
      const forms = readForms(record.japanese);
      const slug = typeof record.slug === "string" && record.slug.length > 0
        ? record.slug
        : forms[0]?.word ?? forms[0]?.reading ?? term;
      return {
        slug,
        isCommon: record.is_common === true,
        jlpt: readStrings(record.jlpt, MAX_LOOKUP_DEFINITIONS),
        forms,
        senses,
      };
    })
    .filter((entry): entry is JishoEntry => entry !== null)
    .slice(0, MAX_LOOKUP_ENTRIES);

  return { term, entries };
};

export const jishoWebUrl = (term: string): string =>
  `https://jisho.org/search/${encodeURIComponent(term)}`;
