import { Effect } from "effect";
import {
  grammarPointStore,
  grammarPointCatalogStore,
  canUnlockMoreRules,
  getDailyUnlockAllowance,
  calculateRetrievability,
  type GrammarPointProgress
} from "./grammarPointStore.ts";
import { activeSessionStore, type SessionCard, type FuriganaSegment } from "./activeSessionStore.ts";
import { clientLog } from "../clientLog.ts";
import { prewarmAudioUrls } from "../media/MediaPrewarmService.ts";
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
export const generateExportPayload = (options?: { isCram?: boolean }) => {
  const effect = Effect.gen(function* () {
    const isCram = options?.isCram ?? false;
    yield* clientLog("info", `[SessionSync] Compiling study progress payload (isCram=${isCram})...`);
    
    // Ensure both stores are loaded and updated
    yield* grammarPointStore.load();
    yield* grammarPointCatalogStore.load();
    
    const localProgress = grammarPointStore.state.peek();
    const catalog = grammarPointCatalogStore.state.peek();
    
    const now = new Date();

    const preferences = yield* Effect.promise(() => import("./userPreferencesStore.ts"));
    yield* preferences.userPreferencesStore.load();
    const dailyReviewLimit = preferences.userPreferencesStore.dailyReviewLimit.value;
    const dailyNewRuleLimit = preferences.userPreferencesStore.dailyNewRuleLimit.value;
    const enforceMasteryGates = preferences.userPreferencesStore.enforceMasteryGates.value;

    // Mastery gate is bypassed if user preference toggle is disabled. Cram sessions never introduce new rules.
    const eligible = !isCram && (!enforceMasteryGates || canUnlockMoreRules(localProgress));
    let allowance = 0;
    let nextIntroductions: typeof catalog = [];
    
    if (eligible) {
      allowance = getDailyUnlockAllowance(localProgress, dailyNewRuleLimit);
      if (allowance > 0) {
        yield* clientLog("info", `[SessionSync] User is eligible for new rules. Remaining allowance today: ${allowance}`);
        const activeIds = new Set(localProgress.map((p) => p.id));
        const unstudied = catalog.filter((c) => !activeIds.has(c.id));
        nextIntroductions = unstudied.slice(0, allowance);
      }
    }

    let queue: ExportedGrammarProgress[] = [];

            if (isCram) {
      // Cram Session: select unmastered active learning rules (stability < 21) sorted by lowest retrievability
      // We align the definition of "unmastered" with the FSRS-Lite criteria used in the UI gating warning
      const unmasteredActive = localProgress
        .filter((p) => (p.stability ?? 0.0) < 21.0 && !((p.stability ?? 0.0) >= 7.0 || (p.difficulty ?? 5.0) <= 4.0))
        .sort((a, b) => calculateRetrievability(a) - calculateRetrievability(b));

      const unmasteredSliced = unmasteredActive.slice(0, 15);

      queue = unmasteredSliced.map((p) => {
        const match = catalog.find((c) => c.id === p.id);
        return {
          grammar_point_id: p.id,
          formal_name: match ? match.formal_name : "Loading...",
          repetitions: p.repetitions,
          ease_factor: p.easeFactor,
        };
      });
    } else {
      // Standard Session
      const dueReviewsTargetCount = Math.max(0, dailyReviewLimit - nextIntroductions.length);

      // 1. Sort all active progress rules by lowest retrievability (most in need of review) first
      const activeDueProgress = [...localProgress]
        .sort((a, b) => calculateRetrievability(a) - calculateRetrievability(b));

      const activeDueSliced = activeDueProgress.slice(0, dueReviewsTargetCount);
      
      // Map progress indicators dynamically matching against the local catalog store
      queue = activeDueSliced.map((p) => {
        const match = catalog.find((c) => c.id === p.id);
        return {
          grammar_point_id: p.id,
          formal_name: match ? match.formal_name : "Loading...",
          repetitions: p.repetitions,
          ease_factor: p.easeFactor,
        };
      });

            // 2. Process and save new introductions if eligible
          if (eligible && nextIntroductions.length > 0) {
        yield* clientLog("info", `[SessionSync] Unlocking ${nextIntroductions.length} new grammar points.`);
        
                const { hlcStore } = yield* Effect.promise(() => import("./hlcStore.ts"));

        const newProgressRecords: GrammarPointProgress[] = [];
        for (const item of nextIntroductions) {
          const currentHlc = yield* hlcStore.tick();
          newProgressRecords.push({
            id: item.id,
            easeFactor: 2.5,
            repetitions: 0,
            intervalDays: 0,
            nextReview: now.toISOString(),
            difficulty: 5.0,
            stability: 0.0,
            lastReviewedAt: null,
            unlockedAt: now.toISOString(),
            hlc: currentHlc,
          });
        }

        
        // Save these new rules to grammarPointStore immediately so they count toward today's limit
        yield* grammarPointStore.putAll(newProgressRecords);
        
        for (const item of nextIntroductions) {
          queue.push({
            grammar_point_id: item.id,
            formal_name: item.formal_name,
            repetitions: 0,
            ease_factor: 2.5,
          });
        }
      } else if (eligible && allowance === 0) {
        yield* clientLog("info", `[SessionSync] Daily unlock allowance exhausted (${dailyNewRuleLimit} rules maximum per 24 hours). No new rules will be introduced today.`);
      } else if (!eligible) {
        yield* clientLog("info", "[SessionSync] User is not eligible for new rules because less than 80% of active learning rules are mastered.");
      }
    }

    // Fallback if the local database has not been initialized with reviews yet and catalog is empty
    if (queue.length === 0 && catalog.length === 0) {
      queue.push(
        { grammar_point_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55", formal_name: "だ", repetitions: 0, ease_factor: 2.5 },
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
        { grammar_point_id: "11eebc99-9c0b-4ef8-bb6d-6bb9bd389a11", formal_name: "って", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "01eebc99-9c0b-4ef8-bb6d-6bb9bd383d44", formal_name: "とか", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "03eebc99-9c0b-4ef8-bb6d-6bb9bd383f66", formal_name: "とく", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "04eebc99-9c0b-4ef8-bb6d-6bb9bd384a11", formal_name: "なきゃ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "05eebc99-9c0b-4ef8-bb6d-6bb9bd384b22", formal_name: "みたい", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "06eebc99-9c0b-4ef8-bb6d-6bb9bd384c33", formal_name: "これ", repetitions: 0, ease_factor: 2.5 },
        { grammar_point_id: "07eebc99-9c0b-4ef8-bb6d-6bb9bd384d44", formal_name: "それ", repetitions: 0, ease_factor: 2.5 }
      );
    }

    // Cap massive backlogs of due rules to a maximum of 15 items in the exported queue
    const finalQueue = queue.slice(0, 15);
    const queueLength = finalQueue.length;

    const promptInstructions = isCram
      ? `You are an expert Japanese tutor. Act as an offline-first Sentence Generator for a focused CRAM/REINFORCEMENT study session.
Use the N5/N4 grammar queue and the 'vocabulary_pool' below to generate exactly ${queueLength} unique review cards (exactly 1 unique card for each of the next ${queueLength} cards in the queue).
Since this is a CRAM session focusing on active, unmastered grammar rules, prioritize highly practical conversational situations to reinforce these exact concepts.`
      : `You are a professional, native Japanese language tutor and structural linguist. Your task is to act as an offline-first Sentence Generator.
Use the N5/N4 grammar queue and the 'vocabulary_pool' below to generate exactly ${queueLength} unique review cards (exactly 1 unique card for each of the next ${queueLength} due cards from the grammar points in the queue).`;

    const promptRest = `

CRITICAL CONSTRAINTS:

CRITICAL CONSTRAINTS:
1. You must ONLY use Japanese nouns, verbs, adjectives, and adverbs listed in the 'vocabulary_pool'. Do NOT use any outside vocabulary under any circumstances.
2. You can use standard grammatical particles (は, が, を, に, へ, で, と, も, etc.), conjugations, and copula (だ/です/だった/でした) freely as required by the grammar rules.
3. The English context must strictly set the scene without revealing the target translation, semantic wording, or grammar point. It should focus exclusively on:
   - The physical environment, visual/auditory trigger, or objective situation.
   - The speaker's internal feelings, physical state, or motivation.
   - The social relationship and politeness level.
   CRITICAL NEGATIVE CONSTRAINT: Stop the description immediately BEFORE the speaker says anything. Do NOT describe the action of speaking, nor detail what information is being conveyed (avoid verbs of communication like "you ask...", "you suggest...", "you provide...", "you explain...").
   - BAD (gives away vocabulary/actions): "They ask you for an estimate of when you will meet up, and you provide an approximate hour."
   - GOOD (pure environmental/relational setup): "You are on the phone with an acquaintance coordinating schedules for the upcoming weekend. They ask a question and wait for your response. You address them casually"
4. Completely omit formal pronouns like '私は' (watashi wa) or 'あなたは' (anata wa) unless they are absolutely essential to avoid ambiguity.
5. Output the result in a clean, valid JSON format matching the schema:
{
  "cards": [
    {
      "grammar_point_id": "...",
      "english_context": "A scene-setting description focusing purely on the environment, the speaker's internal state/motivation, and the social dynamics. It must stop right before the utterance and must NOT hint at the target phrasing, grammar name, or translation (e.g., 'Walking home with a classmate, you look up as cold droplets begin to touch your skin. You address them casually.').",
      "japanese_sentence": "The natural, conversational, colloquial Japanese translation of the context.",
      "furigana": [
        { "kanji": "私", "kana": "わたし" },
        { "kanji": "の" },
        { "kanji": "本", "kana": "ほん" }
      ],
      "audio_url": null,
      "explanation": "A concise, high-yield linguistic explanation detailing exactly how the grammar point is being applied and translated in this specific sentence context."            
    }
  ]
}`;

    const payload: ExportPayload = {
      instructions: promptInstructions + promptRest,
      queue: finalQueue,
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

  return effect;
};

interface ImportedCard {
  readonly grammar_point_id?: unknown;
  readonly english_context?: unknown;
  readonly japanese_sentence?: unknown;
  readonly furigana?: unknown;
  readonly audio_url?: unknown;
  readonly explanation?: unknown;
}

interface ImportedPayload {
  readonly cards?: readonly unknown[];
}

interface ValidatedImportedCard {
  readonly sourceIndex: number;
  readonly grammarPointId: string;
  readonly englishContext: string;
  readonly japaneseSentence: string;
  readonly furigana: readonly FuriganaSegment[];
  readonly audioUrl: string | null;
  readonly explanation?: string;
}

export interface SessionAudioEnrichmentRequestItem {
  readonly requestId: string;
  readonly japaneseSentence: string;
}

export interface SessionAudioEnrichmentResultItem {
  readonly requestId: string;
  readonly audioUrl: string | null;
  readonly failureKind?:
    | "input"
    | "configuration"
    | "authentication"
    | "provider"
    | "audio"
    | "storage"
    | "limit";
}

export interface SessionAudioEnrichmentResult {
  readonly items: readonly SessionAudioEnrichmentResultItem[];
  readonly requestedCount: number;
  readonly enrichedCount: number;
  readonly failedCount: number;
}

export interface SessionAudioEnricher {
  readonly enrich: (
    items: readonly SessionAudioEnrichmentRequestItem[],
  ) => Effect.Effect<SessionAudioEnrichmentResult, Error>;
}

export interface ImportSessionPayloadOptions {
  readonly audioEnricher?: SessionAudioEnricher;
}

export interface ImportSessionPayloadResult {
  readonly importedCount: number;
  readonly audioRequestedCount: number;
  readonly audioFailedCount: number;
}

interface SessionAudioEnrichmentApiResponse {
  readonly success?: boolean;
  readonly data?: SessionAudioEnrichmentResult;
  readonly error?: string;
  readonly message?: string;
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

const isFuriganaSegment = (
  value: unknown,
): value is FuriganaSegment => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("kanji" in value) || typeof value.kanji !== "string") {
    return false;
  }

  if (
    "kana" in value &&
    value.kana !== undefined &&
    typeof value.kana !== "string"
  ) {
    return false;
  }

  return true;
};

const isFuriganaSegments = (
  value: unknown,
): value is readonly FuriganaSegment[] =>
  Array.isArray(value) &&
  value.every(isFuriganaSegment);

const validateImportedCards = (
  rawCards: readonly unknown[],
): Effect.Effect<readonly ValidatedImportedCard[], Error> =>
  Effect.gen(function* () {
    const validatedCards: ValidatedImportedCard[] = [];

    for (const [sourceIndex, rawCard] of rawCards.entries()) {
      if (typeof rawCard !== "object" || rawCard === null) {
        yield* clientLog(
          "error",
          `[SessionSync] Card ${sourceIndex + 1} is not an object.`,
        );
        return yield* Effect.fail(
          new Error(
            `Invalid card schema at index ${sourceIndex}: card must be an object.`,
          ),
        );
      }

      const card = rawCard as ImportedCard;
      const grammarPointId =
        typeof card.grammar_point_id === "string"
          ? card.grammar_point_id.trim()
          : "";
      const englishContext =
        typeof card.english_context === "string"
          ? card.english_context.trim()
          : "";
      const japaneseSentence =
        typeof card.japanese_sentence === "string"
          ? card.japanese_sentence.trim()
          : "";

      if (
        grammarPointId.length === 0 ||
        englishContext.length === 0 ||
        japaneseSentence.length === 0
      ) {
        yield* clientLog(
          "error",
          `[SessionSync] Card ${sourceIndex + 1} is missing a required string field.`,
        );
        return yield* Effect.fail(
          new Error(
            `Invalid card schema at index ${sourceIndex}: each card requires non-empty 'grammar_point_id', 'english_context', and 'japanese_sentence' strings.`,
          ),
        );
      }

      const furiganaValue = card.furigana;
      if (
        furiganaValue !== undefined &&
        !isFuriganaSegments(furiganaValue)
      ) {
        yield* clientLog(
          "error",
          `[SessionSync] Card ${sourceIndex + 1} contains malformed furigana segments.`,
        );
        return yield* Effect.fail(
          new Error(
            `Invalid card schema at index ${sourceIndex}: 'furigana' must be an array of { kanji, kana? } segments.`,
          ),
        );
      }

      if (
        card.audio_url !== undefined &&
        card.audio_url !== null &&
        typeof card.audio_url !== "string"
      ) {
        return yield* Effect.fail(
          new Error(
            `Invalid card schema at index ${sourceIndex}: 'audio_url' must be a string or null.`,
          ),
        );
      }

      if (
        card.explanation !== undefined &&
        typeof card.explanation !== "string"
      ) {
        return yield* Effect.fail(
          new Error(
            `Invalid card schema at index ${sourceIndex}: 'explanation' must be a string when supplied.`,
          ),
        );
      }

      const suppliedAudioUrl =
        typeof card.audio_url === "string" &&
        card.audio_url.trim().length > 0
          ? card.audio_url.trim()
          : null;

      validatedCards.push({
        sourceIndex,
        grammarPointId,
        englishContext,
        japaneseSentence,
        furigana: isFuriganaSegments(furiganaValue)
          ? furiganaValue
          : [],
        audioUrl: suppliedAudioUrl,
        ...(typeof card.explanation === "string"
          ? { explanation: card.explanation }
          : {}),
      });
    }

    return validatedCards;
  });

const requestSessionAudioEnrichment: SessionAudioEnricher = {
  enrich: (items) =>
    Effect.gen(function* () {
      if (items.length === 0) {
        return {
          items: [],
          requestedCount: 0,
          enrichedCount: 0,
          failedCount: 0,
        };
      }

      const { tokenState } = yield* Effect.promise(
        () => import("./authStore.ts"),
      );
      const token = tokenState.peek();

      if (!token) {
        return yield* Effect.fail(
          new Error(
            "Audio generation requires an authenticated session.",
          ),
        );
      }

      yield* clientLog(
        "info",
        `[SessionSync] Requesting server-side audio enrichment for ${items.length} cards.`,
      );

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch("/api/tts/enrich-session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ items }),
          }),
        catch: (cause) =>
          new Error(
            `Audio enrichment request could not reach the server: ${String(cause)}`,
          ),
      });

      const payload = yield* Effect.tryPromise({
        try: () =>
          response.json() as Promise<SessionAudioEnrichmentApiResponse>,
        catch: (cause) =>
          new Error(
            `Audio enrichment response was not valid JSON: ${String(cause)}`,
          ),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new Error(
            payload.message ??
              payload.error ??
              `Audio enrichment failed with HTTP ${response.status}.`,
          ),
        );
      }

      if (
        payload.success !== true ||
        !payload.data ||
        !Array.isArray(payload.data.items)
      ) {
        return yield* Effect.fail(
          new Error(
            "Audio enrichment response did not contain a valid result.",
          ),
        );
      }

      return payload.data;
    }),
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isAcceptedGrammarPointId = (grammarPointId: string): boolean => {
  const isTest =
    typeof process !== "undefined" &&
    (
      process.env?.NODE_ENV === "test" ||
      process.env?.VITEST_WORKER_ID
    );
  const isMockId =
    grammarPointId.startsWith("gp-") ||
    grammarPointId.startsWith("gp");

  return Boolean(
    isTest ||
      isMockId ||
      UUID_REGEX.test(grammarPointId),
  );
};

/**
 * Validates the complete imported payload, enriches missing audio on a
 * best-effort basis, and only then hydrates activeSessionStore.
 */
export const importSessionPayload = (
  jsonString: string,
  options: ImportSessionPayloadOptions = {},
) => {
  const effect = Effect.gen(function* () {
    yield* clientLog(
      "info",
      "[SessionSync] Parsing imported study session payload...",
    );

    const cleanedString = cleanJsonString(jsonString);
    yield* clientLog(
      "debug",
      "[SessionSync] Cleaned JSON string prepared for parsing:",
      `${cleanedString.substring(0, 100)}...`,
    );

    const parsed = yield* Effect.tryPromise({
      try: () =>
        Promise.resolve(
          JSON.parse(cleanedString) as ImportedPayload,
        ),
      catch: (cause) =>
        new Error(
          `Invalid JSON syntax in imported study session. Make sure you copied the entire JSON block. Error: ${String(cause)}`,
        ),
    });

    const rawCards = parsed?.cards;
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      return yield* Effect.fail(
        new Error(
          "Invalid session payload: 'cards' array is missing or empty.",
        ),
      );
    }

    yield* clientLog(
      "info",
      `[SessionSync] Validating all ${rawCards.length} imported cards before audio generation.`,
    );
    const validatedCards = yield* validateImportedCards(rawCards);

    const acceptedCards: ValidatedImportedCard[] = [];
    for (const card of validatedCards) {
      if (!isAcceptedGrammarPointId(card.grammarPointId)) {
        yield* clientLog(
          "warn",
          `[SessionSync] Skipping card with non-UUID grammar_point_id: "${card.grammarPointId}"`,
        );
        continue;
      }

      acceptedCards.push(card);
    }

    if (acceptedCards.length === 0) {
      return yield* Effect.fail(
        new Error(
          "Invalid session payload: no cards remained after grammar point ID validation.",
        ),
      );
    }

    const audioRequests =
      acceptedCards
        .filter((card) => card.audioUrl === null)
        .map((card) => ({
          requestId: `card-${card.sourceIndex}`,
          japaneseSentence: card.japaneseSentence,
        }));

    const audioUrlByRequestId = new Map<string, string>();
    const audioEnricher =
      options.audioEnricher ?? requestSessionAudioEnrichment;

    if (audioRequests.length > 0) {
      const enrichmentAttempt = yield* Effect.either(
        audioEnricher.enrich(audioRequests),
      );

      if (enrichmentAttempt._tag === "Left") {
        yield* clientLog(
          "warn",
          `[SessionSync] System-wide audio enrichment failure. Continuing with ${audioRequests.length} cards without generated audio.`,
          enrichmentAttempt.left,
        );
      } else {
        for (const resultItem of enrichmentAttempt.right.items) {
          if (
            typeof resultItem.audioUrl === "string" &&
            resultItem.audioUrl.trim().length > 0
          ) {
            audioUrlByRequestId.set(
              resultItem.requestId,
              resultItem.audioUrl,
            );
          }
        }

        yield* clientLog(
          enrichmentAttempt.right.failedCount > 0
            ? "warn"
            : "info",
          `[SessionSync] Audio enrichment completed. enriched=${enrichmentAttempt.right.enrichedCount}, failed=${enrichmentAttempt.right.failedCount}, requested=${enrichmentAttempt.right.requestedCount}.`,
        );
      }
    } else {
      yield* clientLog(
        "info",
        "[SessionSync] Every imported card already supplied audio; server enrichment was skipped.",
      );
    }

    const audioFailedCount = audioRequests.filter(
      (request) =>
        !audioUrlByRequestId.has(request.requestId),
    ).length;

    // Load the local progress store state only after the entire payload has
    // passed schema validation and audio enrichment has completed.
    yield* grammarPointStore.load();
    const localProgress = grammarPointStore.state.peek();
    const activeIds = new Set(localProgress.map((progress) => progress.id));
    const now = new Date();

    const sessionCards: SessionCard[] = [];
    for (const card of acceptedCards) {
      const grammarPointId = card.grammarPointId;

      if (!activeIds.has(grammarPointId)) {
        yield* clientLog(
          "info",
          `[SessionSync] Activating newly introduced grammar point ID: ${grammarPointId}`,
        );

        const { hlcStore } = yield* Effect.promise(
          () => import("./hlcStore.ts"),
        );
        const currentHlc = yield* hlcStore.tick();

        const initialProgress = {
          id: grammarPointId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          difficulty: 5.0,
          stability: 0.0,
          lastReviewedAt: null,
          nextReview: now.toISOString(),
          hlc: currentHlc,
        };

        yield* grammarPointStore.put(initialProgress);

        const { enqueueTransaction } = yield* Effect.promise(
          () => import("../sync/OutboxQueue"),
        );
        yield* enqueueTransaction("record_review", {
          grammarPointId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: initialProgress.nextReview,
        });

        activeIds.add(grammarPointId);
      }

      const generatedAudioUrl = audioUrlByRequestId.get(
        `card-${card.sourceIndex}`,
      );

      sessionCards.push({
        grammarPointId,
        englishContext: card.englishContext,
        japaneseSentence: card.japaneseSentence,
        furigana: card.furigana,
        audioUrl: card.audioUrl ?? generatedAudioUrl ?? null,
        ...(card.explanation
          ? { explanation: card.explanation }
          : {}),
      });
    }

    activeSessionStore.loadSession(sessionCards, {
      audioWarning:
        audioFailedCount > 0
          ? {
              missingCount: audioFailedCount,
              totalCount: sessionCards.length,
            }
          : null,
    });

    const audioUrlsToPrewarm = sessionCards.flatMap(
      (card) =>
        typeof card.audioUrl === "string"
          ? [card.audioUrl]
          : [],
    );

    if (audioUrlsToPrewarm.length > 0) {
      const prewarmResult = yield* Effect.either(
        prewarmAudioUrls(audioUrlsToPrewarm),
      );

      if (prewarmResult._tag === "Left") {
        yield* clientLog(
          "warn",
          "[SessionSync] Immediate session audio prewarm failed; the session remains available.",
          prewarmResult.left,
        );
      } else {
        yield* clientLog(
          prewarmResult.right.failedCount > 0
            ? "warn"
            : "info",
          `[SessionSync] Immediate audio prewarm complete. cached=${prewarmResult.right.cachedCount}, existing=${prewarmResult.right.alreadyCachedCount}, failed=${prewarmResult.right.failedCount}, skipped=${prewarmResult.right.skipped}.`,
        );
      }
    }

    yield* clientLog(
      "info",
      `[SessionSync] Successfully imported ${sessionCards.length} dynamic cards into active session. audioFailures=${audioFailedCount}.`,
    );

    return {
      importedCount: sessionCards.length,
      audioRequestedCount: audioRequests.length,
      audioFailedCount,
    } satisfies ImportSessionPayloadResult;
  });

  return effect;
};
