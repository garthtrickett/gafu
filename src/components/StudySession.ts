// File: src/components/StudySession.ts
// ------------------------------------------------------------------------------
// Comprehension-First Study Session UI Component
// ------------------------------------------------------------------------------
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { ReactiveSamController } from "../lib/client/reactive-sam-controller";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore";
import { knowledgePointStore } from "../lib/client/stores/knowledgePointStore";
import { enqueueTransaction } from "../lib/client/sync/OutboxQueue";
import { clientLog } from "../lib/client/clientLog";
import { runClientUnscoped, type BaseClientContext } from "../lib/client/runtime";
import { navigate } from "../lib/client/router";
import { Effect } from "effect";
import "./FuriganaSentence";
import "./JishoLookupModal";
import { calculateSrsUpdate } from "../lib/shared/srs-scheduling.ts";
import { submitExerciseReview } from "../lib/client/media/adaptive/learning-content.ts";
import { tokenState } from "../lib/client/stores/authStore.ts";
import { requestJishoLookup } from "../lib/client/dictionary/jisho-lookup.ts";
import { clearSelection, readSelectedBaseText } from "../lib/client/dictionary/selection.ts";
import { extractJapaneseLookupTerm, type JishoLookupResult } from "../lib/shared/jisho.ts";
export { calculateSrsUpdate } from "../lib/shared/srs-scheduling.ts";

export interface JishoLookupModel {
  readonly term: string;
  readonly status: "loading" | "loaded" | "error";
  readonly result: JishoLookupResult | null;
  readonly message: string;
}

export interface StudySessionModel {
  readonly audioPlaying: boolean;
  readonly explanationVisible: boolean;
  readonly japaneseVisible: boolean;
  readonly lookup: JishoLookupModel | null;
}

export type StudySessionAction =
  | { type: "PLAY_AUDIO"; audioUrl: string }
  | { type: "SUBMIT_GRADE"; knowledgePointId: string; isCorrect: boolean }
  | { type: "TOGGLE_EXPLANATION" }
  | { type: "TOGGLE_JAPANESE" }
  | { type: "FORCE_MASTER"; knowledgePointId: string }
  | { type: "LOOKUP_TERM"; term: string }
  | { type: "LOOKUP_SUCCEEDED"; term: string; result: JishoLookupResult }
  | { type: "LOOKUP_FAILED"; term: string; message: string }
  | { type: "CLOSE_LOOKUP" };

const initialModel: StudySessionModel = {
  audioPlaying: false,
  explanationVisible: false,
  japaneseVisible: false,
  lookup: null,
};

const update = (model: StudySessionModel, action: StudySessionAction): StudySessionModel => {
  switch (action.type) {
    case "PLAY_AUDIO":
      return {
        ...model,
        audioPlaying: true,
      };
    case "FORCE_MASTER":
    case "SUBMIT_GRADE":
      return {
        ...model,
        audioPlaying: false,
        explanationVisible: false,
        japaneseVisible: false,
        lookup: null,
      };
    case "TOGGLE_EXPLANATION":
      return {
        ...model,
        explanationVisible: !model.explanationVisible,
      };
    case "TOGGLE_JAPANESE":
      return {
        ...model,
        japaneseVisible: !model.japaneseVisible,
        // Hiding the sentence removes the text the open lookup came from.
        lookup: model.japaneseVisible ? null : model.lookup,
      };
    case "LOOKUP_TERM":
      return {
        ...model,
        lookup: { term: action.term, status: "loading", result: null, message: "" },
      };
    case "LOOKUP_SUCCEEDED":
      // A superseded lookup must not overwrite the highlight the learner is on.
      return model.lookup?.term === action.term
        ? { ...model, lookup: { ...model.lookup, status: "loaded", result: action.result, message: "" } }
        : model;
    case "LOOKUP_FAILED":
      return model.lookup?.term === action.term
        ? { ...model, lookup: { ...model.lookup, status: "error", result: null, message: action.message } }
        : model;
    case "CLOSE_LOOKUP":
      return {
        ...model,
        lookup: null,
      };
    default:
      return model;
  }
};

@customElement("study-session")
export class StudySession extends LitElement {
  private controller!: ReactiveSamController<this, StudySessionModel, StudySessionAction, never, BaseClientContext>;
  private audioInstance: HTMLAudioElement | null = null;
  private cardStartedAt = Date.now();
  private _disposeEffect?: () => void;

  private isEditableKeyboardTarget = (
    target: EventTarget | null,
  ): boolean =>
    target instanceof HTMLElement &&
    (
      target.matches("input, textarea, select") ||
      target.isContentEditable
    );

  private handleKeyboardShortcut = (event: KeyboardEvent) => {
    if (
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      this.isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const currentCard = activeSessionStore.currentCard.peek();

    // The lookup modal owns the keyboard while it is open, so a grade or a
    // reveal cannot fire behind it.
    if (this.controller.model.lookup) {
      if (key === "escape") {
        event.preventDefault();
        this.closeLookup();
      }
      return;
    }

    if (key === "j" && currentCard) {
      event.preventDefault();
      runClientUnscoped(
        clientLog(
          "info",
          `[StudySession] Keyboard shortcut J toggled Japanese visibility for knowledgePointId=${currentCard.knowledgePointId}.`,
        ),
      );
      this.controller.propose({ type: "TOGGLE_JAPANESE" });
      return;
    }

    if (key === "e") {
      event.preventDefault();
      if (!currentCard || typeof currentCard.explanation !== "string") {
        runClientUnscoped(
          clientLog(
            "warn",
            "[StudySession] Keyboard shortcut E ignored because the current card has no explanation.",
          ),
        );
        return;
      }

      runClientUnscoped(
        clientLog(
          "info",
          `[StudySession] Keyboard shortcut E toggled the explanation for knowledgePointId=${currentCard.knowledgePointId}.`,
        ),
      );
      this.controller.propose({ type: "TOGGLE_EXPLANATION" });
      return;
    }

    if ((key === "c" || key === "i") && currentCard) {
      event.preventDefault();
      const isCorrect = key === "c";
      runClientUnscoped(
        clientLog(
          "info",
          `[StudySession] Keyboard shortcut ${key.toUpperCase()} submitted ${isCorrect ? "correct" : "incorrect"} for knowledgePointId=${currentCard.knowledgePointId}.`,
        ),
      );
      this.controller.propose({
        type: "SUBMIT_GRADE",
        knowledgePointId: currentCard.knowledgePointId,
        isCorrect,
      });
      return;
    }

    if (key !== "r") {
      return;
    }

    event.preventDefault();
    if (!currentCard || typeof currentCard.audioUrl !== "string") {
      runClientUnscoped(
        clientLog(
          "warn",
          "[StudySession] Keyboard shortcut R ignored because the current card has no playable audio.",
        ),
      );
      return;
    }

    runClientUnscoped(
      clientLog(
        "info",
        `[StudySession] Keyboard shortcut R replayed audio for knowledgePointId=${currentCard.knowledgePointId}.`,
      ),
    );
    this.controller.propose({
      type: "PLAY_AUDIO",
      audioUrl: currentCard.audioUrl,
    });
  };

  private closeLookup = () => {
    clearSelection(window.getSelection());
    this.controller.propose({ type: "CLOSE_LOOKUP" });
  };

  // A drag frequently ends outside the sentence box, so the listener lives on the
  // document and the range itself decides whether the highlight is in scope.
  private handleSelectionLookup = () => {
    if (this.controller.model.lookup) return;

    const container = this.querySelector("#japanese-sentence");
    if (!container) return;

    const selected = readSelectedBaseText(window.getSelection(), container);
    if (selected === null) return;

    const term = extractJapaneseLookupTerm(selected);
    if (term === null) return;

    runClientUnscoped(
      clientLog("info", `[StudySession] Highlighted term queued for a Jisho lookup: ${term}.`),
    );
    this.controller.propose({ type: "LOOKUP_TERM", term });
  };

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    // Setup automatic reactive updates when the activeSessionStore signals change state
    this._disposeEffect = effect(() => {
      void activeSessionStore.state.value;
      void activeSessionStore.currentIndex.value;
      void activeSessionStore.batchIndex.value;
      void activeSessionStore.audioWarning.value;
      this.requestUpdate();
    });

    this.controller = new ReactiveSamController(
      this,
      initialModel,
      update,
      (action, model, propose) => this.handleAction(action, model, propose)
    );

    super.connectedCallback();
    window.addEventListener(
      "keydown",
      this.handleKeyboardShortcut,
    );
    document.addEventListener("mouseup", this.handleSelectionLookup);
    document.addEventListener("touchend", this.handleSelectionLookup);

    // Play native audio for the first card immediately if present
    const firstCard = activeSessionStore.currentCard.value;
    this.cardStartedAt = Date.now();
    if (firstCard && typeof firstCard.audioUrl === "string") {
      this.controller.propose({ type: "PLAY_AUDIO", audioUrl: firstCard.audioUrl });
    }
  }

  override disconnectedCallback() {
    window.removeEventListener(
      "keydown",
      this.handleKeyboardShortcut,
    );
    document.removeEventListener("mouseup", this.handleSelectionLookup);
    document.removeEventListener("touchend", this.handleSelectionLookup);
    if (this.audioInstance) {
      this.audioInstance.pause();
      this.audioInstance = null;
    }
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  private handleAction(
    action: StudySessionAction,
    _model: StudySessionModel,
    propose: (action: StudySessionAction) => void
  ): Effect.Effect<void, never, BaseClientContext> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const program = Effect.gen(function* () {
      yield* clientLog("info", `[StudySession] Action processed: ${action.type}`);

      if (action.type === "LOOKUP_TERM") {
        const { term } = action;
        const token = tokenState.peek();
        if (!token) {
          propose({
            type: "LOOKUP_FAILED",
            term,
            message: "Sign in again to use dictionary lookups.",
          });
          return;
        }

        const lookup = yield* Effect.either(requestJishoLookup(token, term));
        if (lookup._tag === "Left") {
          yield* clientLog("warn", `[StudySession] Jisho lookup failed for term=${term}.`, lookup.left);
          propose({ type: "LOOKUP_FAILED", term, message: lookup.left.message });
          return;
        }

        yield* clientLog(
          "info",
          `[StudySession] Jisho returned ${lookup.right.entries.length} entries for term=${term}.`,
        );
        propose({ type: "LOOKUP_SUCCEEDED", term, result: lookup.right });
        return;
      }

      if (action.type === "PLAY_AUDIO") {
        yield* Effect.sync(() => {
          if (self.audioInstance) {
            self.audioInstance.pause();
          }
          self.audioInstance = new Audio(action.audioUrl);
          self.audioInstance.play().catch((e: unknown) => {
            console.warn("[StudySession] Failed to play pronunciation audio:", e);
          });
        });
      }

            if (action.type === "FORCE_MASTER") {
        const { knowledgePointId } = action;
        
        const currentProgress = knowledgePointStore.state.peek().find(p => p.id === knowledgePointId) || {
          id: knowledgePointId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(),
          difficulty: 5.0,
          stability: 0.0,
          lastReviewedAt: null
        };

        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + 21);

        const forcedMetrics = { 
          easeFactor: currentProgress.easeFactor || 2.5,
          repetitions: 3,
          intervalDays: 21,
          nextReview: nextReviewDate.toISOString(),
          difficulty: 3.0,
          stability: 21.0,
          lastReviewedAt: new Date().toISOString()
        };

        yield* clientLog("info", `[StudySession] Force mastered knowledgePointId=${knowledgePointId}:`, forcedMetrics);

        const { hlcStore } = yield* Effect.promise(() => import("../lib/client/stores/hlcStore.ts"));
        const currentHlc = yield* hlcStore.tick();

        yield* knowledgePointStore.put({
          id: knowledgePointId,
          easeFactor: forcedMetrics.easeFactor,
          repetitions: forcedMetrics.repetitions,
          intervalDays: forcedMetrics.intervalDays,
          nextReview: forcedMetrics.nextReview,
          difficulty: forcedMetrics.difficulty,
          stability: forcedMetrics.stability,
          lastReviewedAt: forcedMetrics.lastReviewedAt,
          hlc: currentHlc
        });

        yield* enqueueTransaction("record_review", {
          knowledgePointId: knowledgePointId,
          easeFactor: forcedMetrics.easeFactor,
          repetitions: forcedMetrics.repetitions,
          intervalDays: forcedMetrics.intervalDays,
          nextReview: forcedMetrics.nextReview,
          difficulty: forcedMetrics.difficulty,
          stability: forcedMetrics.stability,
          lastReviewedAt: forcedMetrics.lastReviewedAt
        });

        yield* Effect.sync(() => {
          activeSessionStore.next();
          const nextCard = activeSessionStore.currentCard.value;
          if (nextCard && typeof nextCard.audioUrl === "string") {
            propose({ type: "PLAY_AUDIO", audioUrl: nextCard.audioUrl });
          }
        });
      }

            if (action.type === "SUBMIT_GRADE") {
        const { knowledgePointId, isCorrect } = action;
        const activeCard = activeSessionStore.currentCard.peek();
        if (activeCard?.exerciseId) {
          const { tokenState } = yield* Effect.promise(() => import("../lib/client/stores/authStore.ts"));
          const token = tokenState.peek();
          if (!token) return yield* clientLog("error", "[StudySession] Adaptive exercise review requires authentication.");
          const reviewed = yield* submitExerciseReview(
            token,
            activeCard.exerciseId,
            isCorrect,
            `review:${activeCard.exerciseId}:${self.cardStartedAt}`,
            Math.max(0, Date.now() - self.cardStartedAt),
          );
          const currentProgress = knowledgePointStore.state.peek().find((progress) => progress.id === knowledgePointId);
          const { hlcStore } = yield* Effect.promise(() => import("../lib/client/stores/hlcStore.ts"));
          const currentHlc = yield* hlcStore.tick();
          yield* knowledgePointStore.put({
            id: knowledgePointId,
            kind: currentProgress?.kind,
            participationStatus: currentProgress?.participationStatus ?? "active",
            learningState: reviewed.learningState,
            easeFactor: reviewed.metrics.easeFactor,
            repetitions: reviewed.metrics.repetitions,
            intervalDays: reviewed.metrics.intervalDays,
            nextReview: reviewed.metrics.nextReview,
            difficulty: reviewed.metrics.difficulty,
            stability: reviewed.metrics.stability,
            lastReviewedAt: reviewed.metrics.lastReviewedAt,
            unlockedAt: currentProgress?.unlockedAt,
            checkoutDue: false,
            hlc: currentHlc,
          });
          yield* clientLog("info", `[StudySession] Adaptive review recorded for knowledgePointId=${knowledgePointId}; variedContexts=${reviewed.successfulMaterialContextCount}, masteryLimited=${reviewed.masteryLimited}.`);
          yield* Effect.sync(() => {
            activeSessionStore.next();
            self.cardStartedAt = Date.now();
            const nextCard = activeSessionStore.currentCard.value;
            if (nextCard && typeof nextCard.audioUrl === "string") propose({ type: "PLAY_AUDIO", audioUrl: nextCard.audioUrl });
          });
          return;
        }
        
        // Retrieve existing progress metadata for this grammar rule from IndexedDB, or fallback to standard N5 defaults
        const currentProgress = knowledgePointStore.state.peek().find(p => p.id === knowledgePointId) || {
          id: knowledgePointId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString(),
          difficulty: 5.0,
          stability: 0.0,
          lastReviewedAt: null
        };

        const metrics = calculateSrsUpdate(
          {
            easeFactor: currentProgress.easeFactor,
            repetitions: currentProgress.repetitions,
            intervalDays: currentProgress.intervalDays,
            difficulty: currentProgress.difficulty,
            stability: currentProgress.stability,
          },
          isCorrect
        );

        yield* clientLog("info", `[StudySession] Recalculated SM-2 metrics for knowledgePointId=${knowledgePointId}:`, metrics);

        const { hlcStore } = yield* Effect.promise(() => import("../lib/client/stores/hlcStore.ts"));
        const currentHlc = yield* hlcStore.tick();

        // Persist progress to local store
        yield* knowledgePointStore.put({
          id: knowledgePointId,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
          difficulty: metrics.difficulty,
          stability: metrics.stability,
          lastReviewedAt: metrics.lastReviewedAt,
          hlc: currentHlc
        });

        // Enqueue queue transaction
        yield* enqueueTransaction("record_review", {
          knowledgePointId: knowledgePointId,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
          difficulty: metrics.difficulty,
          stability: metrics.stability,
          lastReviewedAt: metrics.lastReviewedAt
        });

        // Advance progress store indicator sequentially
        yield* Effect.sync(() => {
          activeSessionStore.next();
          self.cardStartedAt = Date.now();
          const nextCard = activeSessionStore.currentCard.value;
          if (nextCard && typeof nextCard.audioUrl === "string") {
            propose({ type: "PLAY_AUDIO", audioUrl: nextCard.audioUrl });
          }
        });
      }
    });

    return program.pipe(
      Effect.catchAll((err) =>
        clientLog("error", `[StudySession] Action execution failed for action: ${action.type}`, err)
      )
    );
  }

  override render() {
    const cards = activeSessionStore.state.value;
    const currentIndex = activeSessionStore.currentIndex.value;
    const isFinished = activeSessionStore.isFinished.value;
    const currentCard = activeSessionStore.currentCard.value;
    const audioWarning = activeSessionStore.audioWarning.value;
    const {
      explanationVisible,
      japaneseVisible,
      lookup,
    } = this.controller.model;

    if (isFinished) {
      const hasMore = activeSessionStore.hasMoreBatches.value;
      if (hasMore) {
        return html`
          <div class="max-w-xl mx-auto py-12 px-6 bg-zinc-950 border border-zinc-800 rounded-lg text-center space-y-6 animate-fade-in">
            <div class="inline-flex p-4 bg-green-500/10 text-green-500 rounded-full">
              <span class="text-3xl">💪</span>
            </div>
            <h2 class="text-2xl font-bold">Batch Cleared!</h2>
            <p class="text-zinc-400 text-sm">
              Excellent work! You cleared this chunk of 15 reviews. Take a quick break, or continue studying the remaining cards.
            </p>
            <div class="flex items-center justify-center gap-4">
              <button
                @click=${() => runClientUnscoped(navigate("/"))}
                class="px-6 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-medium rounded text-sm transition-colors cursor-pointer"
              >
                Take a Break
              </button>
              <button
                @click=${() => { activeSessionStore.startNextBatch(); }}
                class="px-6 py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-bold rounded text-sm transition-colors cursor-pointer"
              >
                Study Next Chunk
              </button>
            </div>
          </div>
        `;
      }

      return html`
        <div class="max-w-xl mx-auto py-12 px-6 bg-zinc-950 border border-zinc-800 rounded-lg text-center space-y-6">
          <div class="inline-flex p-4 bg-green-500/10 text-green-500 rounded-full">
            <span class="text-3xl">🎉</span>
          </div>
          <h2 class="text-2xl font-bold">Review Completed!</h2>
          <p class="text-zinc-400 text-sm">
            All caught up with your study goals. Any review scores have been queued and are syncing.
          </p>
          <button
            @click=${() => runClientUnscoped(navigate("/"))}
            class="px-6 py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-medium rounded text-sm transition-colors cursor-pointer"
          >
            Back to Study Desk
          </button>
        </div>
      `;
    }

    if (!currentCard) {
      return html`
        <div class="max-w-xl mx-auto py-12 text-center text-zinc-400">
          Loading cards...
        </div>
      `;
    }

    return html`
      <div class="max-w-xl mx-auto space-y-6">
        ${audioWarning
          ? html`
              <div
                role="status"
                class="flex items-start justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              >
                <p>
                  Audio could not be generated for
                  <strong>${audioWarning.missingCount}</strong>
                  of
                  <strong>${audioWarning.totalCount}</strong>
                  imported cards. Reading review is still available.
                </p>
                <button
                  type="button"
                  @click=${() => activeSessionStore.dismissAudioWarning()}
                  class="shrink-0 text-xs font-semibold text-amber-200 hover:text-white cursor-pointer"
                  aria-label="Dismiss audio generation warning"
                >
                  Dismiss
                </button>
              </div>
            `
          : ""}
        <div class="flex items-center justify-between text-xs text-zinc-500">
          <span>Card ${currentIndex + 1} of ${cards.length}</span>
          <span>Progress: ${Math.round((currentIndex / cards.length) * 100)}%</span>
        </div>
        <div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div class="bg-green-500 h-full transition-all duration-300" style="width: ${(currentIndex / cards.length) * 100}%"></div>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-xl shadow-lg overflow-hidden min-h-[340px] flex flex-col justify-between p-8 space-y-6">
          <!-- Comprehension-first face: context is visible while Japanese remains recall-gated. -->
          <div class="flex-1 flex flex-col justify-center items-center text-center space-y-6">
            <div class="space-y-2">
              <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Context</span>
              <p class="text-lg text-zinc-300">${currentCard.englishContext}</p>
            </div>

            <div class="space-y-3 w-full border-t border-zinc-900/60 pt-6">
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Japanese</span>
                <span class="text-[10px] font-medium text-zinc-600 uppercase tracking-widest">
                  ${japaneseVisible ? "Highlight a word for Jisho" : "Shortcut: J"}
                </span>
              </div>
              ${japaneseVisible
                ? html`
                    <div
                      id="japanese-sentence"
                      class="p-4 bg-zinc-900/40 border border-zinc-800/40 rounded-lg flex items-center justify-center animate-fade-in"
                    >
                      <furigana-sentence .segments=${currentCard.furigana}></furigana-sentence>
                    </div>
                  `
                : html`
                    <div
                      id="japanese-sentence-hidden"
                      class="min-h-20 p-4 bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center"
                    >
                      <p class="text-sm text-zinc-500">
                        Recall the sentence, then reveal it.
                      </p>
                    </div>
                  `}
            </div>

            <div class="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                @click=${() => this.controller.propose({ type: "TOGGLE_JAPANESE" })}
                class="p-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded-full transition-colors border border-zinc-800 cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                title="Toggle Japanese sentence (J)"
                aria-keyshortcuts="J"
                aria-pressed=${japaneseVisible ? "true" : "false"}
              >
                ${japaneseVisible ? "Hide Japanese" : "Show Japanese"} <kbd class="text-zinc-500">J</kbd>
              </button>

              ${currentCard.audioUrl
                ? html`
                    <button
                      type="button"
                      @click=${() => this.controller.propose({ type: "PLAY_AUDIO", audioUrl: currentCard.audioUrl! })}
                      class="p-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded-full transition-colors border border-zinc-800 cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                      title="Replay pronunciation audio (R)"
                      aria-keyshortcuts="R"
                    >
                      🔊 Listen <kbd class="text-zinc-500">R</kbd>
                    </button>
                  `
                : ""}

              ${currentCard.explanation
                ? html`
                    <button
                      type="button"
                      @click=${() => this.controller.propose({ type: "TOGGLE_EXPLANATION" })}
                      class="p-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded-full transition-colors border border-zinc-800 cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                      title="Toggle grammatical explanation (E)"
                      aria-keyshortcuts="E"
                    >
                      💡 ${explanationVisible ? "Hide Explanation" : "Explain"}
                      <kbd class="text-zinc-500">E</kbd>
                    </button>
                  `
                : ""}
            </div>

            ${currentCard.explanation && explanationVisible
              ? html`
                  <div class="w-full text-left p-4 bg-zinc-900/60 border border-zinc-800 rounded-lg space-y-2 animate-fade-in">
                    <span class="text-xs font-semibold text-green-400 uppercase tracking-wider block">Grammar Explanation</span>
                    <p class="text-xs text-zinc-300 leading-relaxed">${currentCard.explanation}</p>
                  </div>
                `
              : ""}
          </div>

          <!-- Single-click verification buttons -->
          <div class="pt-4 border-t border-zinc-900 flex flex-col gap-4 w-full">
            <div class="grid grid-cols-2 gap-4 w-full">
              <button
                type="button"
                @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", knowledgePointId: currentCard.knowledgePointId, isCorrect: false })}
                class="py-3 bg-red-650 hover:bg-red-600 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer flex items-center justify-center gap-2"
                title="Mark answer incorrect (I)"
                aria-keyshortcuts="I"
              >
                Incorrect <kbd class="text-red-200/70">I</kbd>
              </button>
              <button
                type="button"
                @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", knowledgePointId: currentCard.knowledgePointId, isCorrect: true })}
                class="py-3 bg-green-650 hover:bg-green-600 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer flex items-center justify-center gap-2"
                title="Mark answer correct (C)"
                aria-keyshortcuts="C"
              >
                Correct <kbd class="text-green-100/70">C</kbd>
              </button>
            </div>
            ${currentCard.exerciseId ? html`<p class="text-center text-xs text-amber-300">Long intervals unlock only after successful retrieval in two materially different contexts.</p>` : html`<button
              @click=${() => this.controller.propose({ type: "FORCE_MASTER", knowledgePointId: currentCard.knowledgePointId })}
              class="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-medium rounded-lg transition-colors text-xs cursor-pointer border border-zinc-700 flex items-center justify-center gap-1.5"
            >
              🎓 Mark as Mastered
            </button>`}
          </div>
        </div>

        ${lookup
          ? html`
              <jisho-lookup-modal
                .term=${lookup.term}
                .status=${lookup.status}
                .result=${lookup.result}
                .message=${lookup.message}
                @jisho-close=${this.closeLookup}
              ></jisho-lookup-modal>
            `
          : ""}
      </div>
    `;
  }
}
