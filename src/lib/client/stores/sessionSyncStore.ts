import { Effect } from "effect";
import { grammarPointStore } from "./grammarPointStore";
import { activeSessionStore, type SessionCard, type FuriganaSegment } from "./activeSessionStore";
import { clientLog } from "../clientLog";
import kaishiPool from "./kaishiPool.json";

export interface ExportedGrammarProgress {
  readonly grammar_point_id: string;
  readonly formal_name: string;
  readonly repetitions: number;
  readonly ease_factor: number;
}

export interface ExportPayload {
  readonly instructions: string;
  readonly theme_preference: string;
  readonly queue: readonly ExportedGrammarProgress[];
  readonly vocabulary_pool: readonly string[];
}

/**
 * Collects N5 grammar states from IndexedDB and copies a lightweight payload to the clipboard
 */
export const generateExportPayload = (theme = "daily") =>
  Effect.gen(function* () {
    yield* clientLog("info", "[SessionSync] Compiling study progress payload...");
    
    // Ensure the grammar point database progresses are hydrated
    yield* grammarPointStore.load();
    
    const localProgress = grammarPointStore.state.peek();
    
    // Map progress indicators
    const queue: ExportedGrammarProgress[] = localProgress.map((p) => ({
      grammar_point_id: p.id,
      formal_name: p.id === "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55" ? "だ" :
                   p.id === "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f66" ? "です" : "は",
      repetitions: p.repetitions,
      ease_factor: p.easeFactor,
    }));
    
    // Fallback if the local database has not been initialized with reviews yet
    if (queue.length === 0) {
      queue.push(
        { grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", formal_name: "だ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f66", formal_name: "です", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "00eebc99-9c0b-4ef8-bb6d-6bb9bd381a11", formal_name: "は", repetitions: 0, ease_factor: 2.5 }
      );
    }

    const promptInstructions = `You are an expert native Japanese language tutor and structural linguist. Your task is to act as a Sentence Generator.
Use the N5 grammar queue and the 'vocabulary_pool' below to generate exactly 1 unique review card for each grammar point in the queue.

CRITICAL CONSTRAINTS:
1. You must ONLY use Japanese nouns, verbs, adjectives, and adverbs listed in the 'vocabulary_pool'. Do NOT use any outside vocabulary under any circumstances.
2. You can use standard grammatical particles (は, が, を, に, へ, で, と, も, etc.), conjugations, and copula (だ/です/だった/でした) freely as required by the grammar rules.
3. Completely omit formal pronouns like '私は' (watashi wa) or 'あなたは' (anata wa) unless they are absolutely essential to avoid ambiguity.
4. Output the result in a clean, valid JSON format matching the schema:
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
      theme_preference: theme,
      queue,
      vocabulary_pool: kaishiPool,
    };

    const jsonString = JSON.stringify(payload, null, 2);
    
    // Write the compiled payload string directly to the user's system clipboard
    yield* Effect.tryPromise({      try: () => navigator.clipboard.writeText(jsonString),
      catch: (e) => new Error(`Failed to write text to system clipboard: ${String(e)}`),
    });

    yield* clientLog("info", "[SessionSync] Study progress successfully copied to clipboard.");
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
 * Validates the imported dynamic study payload and hydrates activeSessionStore
 */
export const importSessionPayload = (jsonString: string) =>
  Effect.gen(function* () {
    yield* clientLog("info", "[SessionSync] Parsing imported study session payload...");
    
    const parsed = yield* Effect.tryPromise({
      try: () => Promise.resolve(JSON.parse(jsonString) as ImportedPayload),
      catch: (e) => new Error(`Invalid JSON syntax in imported study session. Error: ${String(e)}`),
    });

    const cards = parsed?.cards;
    if (!Array.isArray(cards)) {
      return yield* Effect.fail(new Error("Invalid session payload: 'cards' array is missing."));
    }

    const sessionCards: SessionCard[] = [];
    for (const card of cards as readonly ImportedCard[]) {
      if (!card.grammar_point_id || !card.english_context || !card.japanese_sentence) {
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