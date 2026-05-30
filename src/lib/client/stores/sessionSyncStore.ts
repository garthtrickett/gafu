import { Effect } from "effect";
import { grammarPointStore } from "./grammarPointStore";
import { activeSessionStore, type SessionCard, type FuriganaSegment } from "./activeSessionStore";
import { clientLog } from "../clientLog";
import kaishiPool from "./kaishiPool.json";

export const GRAMMAR_POINT_NAMES: Record<string, string> = {
  "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55": "だ",
  "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f66": "です",
  "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11": "は",
  "11eebc99-9c0b-4ef8-bb6d-6bb9bd381b22": "も",
  "22eebc99-9c0b-4ef8-bb6d-6bb9bd381c33": "に",
  "33eebc99-9c0b-4ef8-bb6d-6bb9bd381d44": "で",
  "44eebc99-9c0b-4ef8-bb6d-6bb9bd381e55": "を",
  "55eebc99-9c0b-4ef8-bb6d-6bb9bd381f66": "が",
  "66eebc99-9c0b-4ef8-bb6d-6bb9bd382a11": "から",
  "77eebc99-9c0b-4ef8-bb6d-6bb9bd382b22": "まで",
  "88eebc99-9c0b-4ef8-bb6d-6bb9bd382c33": "と",
  "99eebc99-9c0b-4ef8-bb6d-6bb9bd382d44": "よ",
  "aaeebc99-9c0b-4ef8-bb6d-6bb9bd382e55": "ね",
  "bbeebc99-9c0b-4ef8-bb6d-6bb9bd382f66": "～んです",
  "cceebc99-9c0b-4ef8-bb6d-6bb9bd383a11": "の",
  "ddeebc99-9c0b-4ef8-bb6d-6bb9bd383b22": "けど",
  "eeeebc99-9c0b-4ef8-bb6d-6bb9bd383c33": "って",
  "01eebc99-9c0b-4ef8-bb6d-6bb9bd383d44": "とか",
  "02eebc99-9c0b-4ef8-bb6d-6bb9bd383e55": "ちゃう",
  "03eebc99-9c0b-4ef8-bb6d-6bb9bd383f66": "とく",
  "04eebc99-9c0b-4ef8-bb6d-6bb9bd384a11": "なきゃ",
  "05eebc99-9c0b-4ef8-bb6d-6bb9bd384b22": "みたい"
};

export interface ExportedGrammarProgress {
  readonly grammar_point_id: string;
  readonly formal_name: string;
  readonly repetitions: number;
  readonly ease_factor: number;
}

export interface ExportPayload {
  readonly instructions: string;
  readonly queue: readonly ExportedGrammarProgress[];
  readonly vocabulary_pool: readonly string[];
}

/**
 * Collects N5/N4 grammar states from IndexedDB and copies a lightweight payload to the clipboard
 */
export const generateExportPayload = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[SessionSync] Compiling study progress payload...");
    
    // Ensure the grammar point database progresses are hydrated
    yield* grammarPointStore.load();
    
    const localProgress = grammarPointStore.state.peek();
    
    // Map progress indicators
    const queue: ExportedGrammarProgress[] = localProgress.map((p) => ({
      grammar_point_id: p.id,
      formal_name: GRAMMAR_POINT_NAMES[p.id] || "は",
      repetitions: p.repetitions,
      ease_factor: p.easeFactor,
    }));
    
    // Fallback if the local database has not been initialized with reviews yet
    if (queue.length === 0) {
      queue.push(
        { grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", formal_name: "だ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f66", formal_name: "です", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11", formal_name: "は", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "11eebc99-9c0b-4ef8-bb6d-6bb9bd381b22", formal_name: "も", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "22eebc99-9c0b-4ef8-bb6d-6bb9bd381c33", formal_name: "に", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "33eebc99-9c0b-4ef8-bb6d-6bb9bd381d44", formal_name: "で", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "44eebc99-9c0b-4ef8-bb6d-6bb9bd381e55", formal_name: "を", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "55eebc99-9c0b-4ef8-bb6d-6bb9bd381f66", formal_name: "が", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "66eebc99-9c0b-4ef8-bb6d-6bb9bd382a11", formal_name: "から", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "77eebc99-9c0b-4ef8-bb6d-6bb9bd382b22", formal_name: "まで", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "88eebc99-9c0b-4ef8-bb6d-6bb9bd382c33", formal_name: "と", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "99eebc99-9c0b-4ef8-bb6d-6bb9bd382d44", formal_name: "よ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "aaeebc99-9c0b-4ef8-bb6d-6bb9bd382e55", formal_name: "ね", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "bbeebc99-9c0b-4ef8-bb6d-6bb9bd382f66", formal_name: "～んです", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "cceebc99-9c0b-4ef8-bb6d-6bb9bd383a11", formal_name: "の", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "ddeebc99-9c0b-4ef8-bb6d-6bb9bd383b22", formal_name: "けど", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "eeeebc99-9c0b-4ef8-bb6d-6bb9bd383c33", formal_name: "って", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "01eebc99-9c0b-4ef8-bb6d-6bb9bd383d44", formal_name: "とか", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "02eebc99-9c0b-4ef8-bb6d-6bb9bd383e55", formal_name: "ちゃう", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "03eebc99-9c0b-4ef8-bb6d-6bb9bd383f66", formal_name: "とく", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "04eebc99-9c0b-4ef8-bb6d-6bb9bd384a11", formal_name: "なきゃ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "05eebc99-9c0b-4ef8-bb6d-6bb9bd384b22", formal_name: "みたい", repetitions: 0, ease_factor: 2.5 }
      );
    }

    const queueLength = queue.length;

    const promptInstructions = `You are a professional, native Japanese language tutor and structural linguist. Your task is to act as an offline-first Sentence Generator.
Use the N5/N4 grammar queue and the 'vocabulary_pool' below to generate exactly ${queueLength} unique review cards (exactly 1 unique card for each of the ${queueLength} grammar points in the queue).

CRITICAL CONSTRAINTS:
1. You must ONLY use Japanese nouns, verbs, adjectives, and adverbs listed in the 'vocabulary_pool'. Do NOT use any outside vocabulary under any circumstances.
2. You can use standard grammatical particles (は, が, を, に, へ, で, と, も, etc.), conjugations, and copula (だ/です/だった/でした) freely as required by the grammar rules.
3. You should craft diverse, natural conversational contexts (e.g., daily interactions, simple travel situations, or casual chats) using only words from the 'vocabulary_pool' to make the sentences vivid and highly engaging.
4. Completely omit formal pronouns like '私は' (watashi wa) or 'あなたは' (anata wa) unless they are absolutely essential to avoid ambiguity.
5. Output the result in a clean, valid JSON format matching the schema:
{
  "cards": [
    {
      "grammar_point_id": "...",
      "english_context": "A micro-targeted, clear English situational context primer to prepare the learner's brain. (e.g., 'At a bar, casually asking the bartender for another beer.')",
      "japanese_sentence": "The natural, conversational, colloquial Japanese translation of the context.",
      "furigana": [
        { "kanji": "私", "kana": "わたし" },
        { "kanji": "の" },
        { "kanji": "本", "kana": "ほん" }
      ],
      "audio_url": null
    }
  ]
}`;

    const payload: ExportPayload = {
      instructions: promptInstructions,
      queue,
      vocabulary_pool: kaishiPool,
    };

    const jsonString = JSON.stringify(payload, null, 2);
    
    // Write the compiled payload string directly to the user's system clipboard
    yield* Effect.tryPromise({
      try: () => navigator.clipboard.writeText(jsonString),
      catch: (e) => new Error(`Failed to write text to system clipboard: ${String(e)}`),
    });

    yield* clientLog("info", "[SessionSync] Study progress successfully copied to clipboard.", { wordPoolSize: kaishiPool.length, queueSize: queueLength });
    return jsonString;
  });

interface ImportedCard {
  readonly grammar_point_id?: string;
  readonly english_context?: string;
  readonly japanese_sentence?: string;
  readonly furigana?: readonly FuriganaSegment[];
  readonly audio_url?: string | null;
}

interface ImportedPayload {
  readonly cards?: readonly ImportedCard[];
}

/**
 * Helper to clean markdown backticks from LLM responses before parsing
 */
const cleanJsonString = (raw: string): string => {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    // Strip out opening ```json or ```
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "");
    // Strip out closing ```
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return cleaned.trim();
};

/**
 * Validates the imported dynamic study payload and hydrates activeSessionStore
 */
export const importSessionPayload = (jsonString: string) =>
  Effect.gen(function* () {
    yield* clientLog("info", "[SessionSync] Parsing imported study session payload...");
    
    const cleanedString = cleanJsonString(jsonString);
    yield* clientLog("debug", "[SessionSync] Cleaned JSON string prepared for parsing:", cleanedString.substring(0, 100) + "...");

    const parsed = yield* Effect.tryPromise({
      try: () => Promise.resolve(JSON.parse(cleanedString) as ImportedPayload),
      catch: (e) => new Error(`Invalid JSON syntax in imported study session. Make sure you copied the entire JSON block. Error: ${String(e)}`),
    });

    const cards = parsed?.cards;
    if (!Array.isArray(cards)) {
      return yield* Effect.fail(new Error("Invalid session payload: 'cards' array is missing or empty."));
    }

    const sessionCards: SessionCard[] = [];
    for (const card of cards as readonly ImportedCard[]) {
      if (!card.grammar_point_id || !card.english_context || !card.japanese_sentence) {
        yield* clientLog("error", "[SessionSync] Skipping malformed card:", card);
        return yield* Effect.fail(new Error("Invalid card schema: each card requires 'grammar_point_id', 'english_context', and 'japanese_sentence'."));
      }
      
      sessionCards.push({
        grammarPointId: card.grammar_point_id,
        englishContext: card.english_context,
        japaneseSentence: card.japanese_sentence,
        furigana: card.furigana || [],
        audioUrl: card.audio_url || null,
      });
    }

    activeSessionStore.loadSession(sessionCards);
    yield* clientLog("info", `[SessionSync] Successfully imported ${sessionCards.length} dynamic cards into active session.`);
  });
