import { Effect } from "effect";
import { grammarPointStore, grammarPointCatalogStore } from "./grammarPointStore";
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
  readonly queue: readonly ExportedGrammarProgress[];
  readonly vocabulary_pool: readonly string[];
}

/**
 * Collects N5/N4 grammar states from IndexedDB and copies a lightweight payload to the clipboard
 */
export const generateExportPayload = () =>
  Effect.gen(function* () {
    yield* clientLog("info", "[SessionSync] Compiling study progress payload...");
    
    // Ensure both stores are loaded and updated
    yield* grammarPointStore.load();
    yield* grammarPointCatalogStore.load();
    
    const localProgress = grammarPointStore.state.peek();
    const catalog = grammarPointCatalogStore.state.peek();
    
        // Map progress indicators dynamically matching against the local catalog store
    const queue: ExportedGrammarProgress[] = localProgress.map((p) => {
      const match = catalog.find((c) => c.id === p.id);
      return {
        grammar_point_id: p.id,
        formal_name: match ? match.formal_name : "は",
        repetitions: p.repetitions,
        ease_factor: p.easeFactor,
      };
    });

    // GATING & EXPANSION: If the active review cycle has fewer than 15 rules,
    // look ahead and pull the next 5 locked (unstudied) grammar points from the catalog.
    if (queue.length < 15) {
      yield* clientLog("info", `[SessionSync] Active queue size (${queue.length}) is below threshold of 15. Appending new catalog rules...`);
      const activeIds = new Set(localProgress.map((p) => p.id));
      const unstudied = catalog.filter((c) => !activeIds.has(c.id));
      
      // Slice the first 5 unstudied rules (the relative sequence is preserved in catalog seed order)
      const nextIntroductions = unstudied.slice(0, 5);
      
      for (const item of nextIntroductions) {
        queue.push({
          grammar_point_id: item.id,
          formal_name: item.formal_name,
          repetitions: 0,
          ease_factor: 2.5,
        });
      }
    }
    
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
3. You should craft diverse, natural conversational contexts (e.g., daily interactions, simple travel situations, or casual chats) using only words from the 'vocabulary_pool'. The English context MUST describe the situation at or before the moment of speaking, not a direct translation of the target Japanese.
4. Completely omit formal pronouns like '私は' (watashi wa) or 'あなたは' (anata wa) unless they are absolutely essential to avoid ambiguity.
5. Output the result in a clean, valid JSON format matching the schema:
{
  "cards": [
    {
      "grammar_point_id": "...",
      "english_context": "A situational description of the moment BEFORE or AT the time of speaking (e.g., 'Realizing you forgot your wallet at the register, casually asking your friend to cover you.'). DO NOT provide a direct translation.",
      "japanese_sentence": "The natural, conversational, colloquial Japanese translation of the context.",
      "furigana": [
        { "kanji": "私", "kana": "わたし" },
        { "kanji": "の" },
        { "kanji": "本", "kana": "ほん" }
      ],
      "audio_url": null
      "explanation": "A concise, high-yield linguistic explanation detailing exactly how the grammar point is being applied and translated in this specific sentence context."            
    }
  ]
}`;

    const payload: ExportPayload = {
      instructions: promptInstructions,
      queue,
      vocabulary_pool: kaishiPool,
    };

    const jsonString = JSON.stringify(payload, null, 2);
    
        // Write the compiled payload string directly to the user's system clipboard if API is available
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      yield* Effect.tryPromise({
        try: () => navigator.clipboard.writeText(jsonString),
        catch: (e) => new Error(`Failed to write text to system clipboard: ${String(e)}`),
      });
    } else {
      yield* clientLog("warn", "[SessionSync] Clipboard API not available in this environment.");
    }

    yield* clientLog("info", "[SessionSync] Study progress successfully copied to clipboard.", { wordPoolSize: kaishiPool.length, queueSize: queueLength });
    return jsonString;
  });

interface ImportedCard {
  readonly grammar_point_id?: string;
  readonly english_context?: string;
  readonly japanese_sentence?: string;
  readonly furigana?: readonly FuriganaSegment[];
  readonly audio_url?: string | null;
  readonly explanation?: string;
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

            // Load the local progress store state to identify unrecognized incoming grammar points
        yield* grammarPointStore.load();
        const localProgress = grammarPointStore.state.peek();
        const activeIds = new Set(localProgress.map((p) => p.id));
        const now = new Date();

        const sessionCards: SessionCard[] = [];
        for (const card of cards as readonly ImportedCard[]) {
          if (!card.grammar_point_id || !card.english_context || !card.japanese_sentence) {
            yield* clientLog("error", "[SessionSync] Skipping malformed card:", card);
            return yield* Effect.fail(new Error("Invalid card schema: each card requires 'grammar_point_id', 'english_context', and 'japanese_sentence'."));
          }
          
          const gpId = card.grammar_point_id;

          // GATING & ACTIVATION: If an imported card belongs to a previously locked grammar point,
          // initialize its local progress and notify the sync system of activation.
          if (!activeIds.has(gpId)) {
            yield* clientLog("info", `[SessionSync] Activating newly introduced grammar point ID: ${gpId}`);
            
            const initialProgress = {
              id: gpId,
              easeFactor: 2.5,
              repetitions: 0,
              intervalDays: 0,
              nextReview: now.toISOString(),
            };
            
            // Persist locally
            yield* grammarPointStore.put(initialProgress);

            // Notify backend through outbox sync transaction
            const { enqueueTransaction } = yield* Effect.promise(() => import("../sync/OutboxQueue"));
            yield* enqueueTransaction("record_review", {
              grammarPointId: gpId,
              easeFactor: 2.5,
              repetitions: 0,
              intervalDays: 0,
              nextReview: initialProgress.nextReview,
            });

            // Prevent multiple initializations if multiple cards reference the same ID in this payload
            activeIds.add(gpId);
          }

                    sessionCards.push({
            grammarPointId: gpId,
            englishContext: card.english_context,
            japaneseSentence: card.japanese_sentence,
            furigana: card.furigana || [],
            audioUrl: card.audio_url || null,
            explanation: card.explanation,
          });
        }

    activeSessionStore.loadSession(sessionCards);
    yield* clientLog("info", `[SessionSync] Successfully imported ${sessionCards.length} dynamic cards into active session.`);
  });
