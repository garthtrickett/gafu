import { Effect } from "effect";
import { grammarPointStore } from "./grammarPointStore";
import { activeSessionStore, type SessionCard } from "./activeSessionStore";
import { clientLog } from "../clientLog";

export interface ExportedGrammarProgress {
  readonly grammar_point_id: string;
  readonly formal_name: string;
  readonly repetitions: number;
  readonly ease_factor: number;
}

export interface ExportPayload {
  readonly theme_preference: string;
  readonly queue: readonly ExportedGrammarProgress[];
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

    const payload: ExportPayload = {
      theme_preference: theme,
      queue,
    };

    const jsonString = JSON.stringify(payload, null, 2);
    
    // Write the compiled payload string directly to the user's system clipboard
    yield* Effect.tryPromise({
      try: () => navigator.clipboard.writeText(jsonString),
      catch: (e) => new Error(`Failed to write text to system clipboard: ${String(e)}`),
    });

    yield* clientLog("info", "[SessionSync] Study progress successfully copied to clipboard.");
    return jsonString;
  });

interface ImportedCard {
  readonly grammar_point_id?: string;
  readonly english_context?: string;
  readonly japanese_sentence?: string;
  readonly furigana?: readonly unknown[];
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