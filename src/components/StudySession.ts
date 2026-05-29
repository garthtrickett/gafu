// File: src/components/StudySession.ts
// ------------------------------------------------------------------------------
// Comprehension-First Study Session UI Component
// ------------------------------------------------------------------------------
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { ReactiveSamController } from "../lib/client/reactive-sam-controller";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore";
import { grammarPointStore } from "../lib/client/stores/grammarPointStore";
import { enqueueTransaction } from "../lib/client/sync/OutboxQueue";
import { clientLog } from "../lib/client/clientLog";
import { runClientUnscoped, type BaseClientContext } from "../lib/client/runtime";
import { navigate } from "../lib/client/router";
import { Effect } from "effect";
import "./FuriganaSentence";

export const calculateSrsUpdate = (
  current: { easeFactor: number; repetitions: number; intervalDays: number },
  isCorrect: boolean
) => {
  let easeFactor = current.easeFactor || 2.5;
  let repetitions = current.repetitions || 0;
  let intervalDays = current.intervalDays || 0;

  if (isCorrect) {
    repetitions = repetitions + 1;
    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.ceil(intervalDays * easeFactor);
    }
    easeFactor = Math.max(1.3, easeFactor + 0.15);
  } else {
    repetitions = 0;
    intervalDays = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  }

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + intervalDays);

  return {
    easeFactor: Math.round(easeFactor * 100) / 100,
    repetitions,
    intervalDays,
    nextReview: nextReview.toISOString(),
  };
};

export interface StudySessionModel {
  readonly audioPlaying: boolean;
}

export type StudySessionAction =
  | { type: "PLAY_AUDIO"; audioUrl: string }
  | { type: "SUBMIT_GRADE"; grammarPointId: string; isCorrect: boolean };

const initialModel: StudySessionModel = {
  audioPlaying: false,
};

const update = (model: StudySessionModel, action: StudySessionAction): StudySessionModel => {
  switch (action.type) {
    case "PLAY_AUDIO":
      return {
        ...model,
        audioPlaying: true,
      };
    case "SUBMIT_GRADE":
      return {
        ...model,
        audioPlaying: false,
      };
    default:
      return model;
  }
};

@customElement("study-session")
export class StudySession extends LitElement {
  private controller!: ReactiveSamController<this, StudySessionModel, StudySessionAction, never, BaseClientContext>;
  private audioInstance: HTMLAudioElement | null = null;
  private _disposeEffect?: () => void;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    // Setup automatic reactive updates when the activeSessionStore signals change state
    this._disposeEffect = effect(() => {
      void activeSessionStore.state.value;
      void activeSessionStore.currentIndex.value;
      this.requestUpdate();
    });

    this.controller = new ReactiveSamController(
      this,
      initialModel,
      update,
      (action, model, propose) => this.handleAction(action, model, propose)
    );

    super.connectedCallback();

    // Play native audio for the first card immediately if present
    const firstCard = activeSessionStore.currentCard.value;
    if (firstCard && typeof firstCard.audioUrl === "string") {
      this.controller.propose({ type: "PLAY_AUDIO", audioUrl: firstCard.audioUrl });
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  private handleAction(
    action: StudySessionAction,
    _model: StudySessionModel,
    _propose: (action: StudySessionAction) => void
  ): Effect.Effect<void, never, BaseClientContext> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const program = Effect.gen(function* () {
      yield* clientLog("info", `[StudySession] Action processed: ${action.type}`);

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

      if (action.type === "SUBMIT_GRADE") {
        const { grammarPointId, isCorrect } = action;
        
        // Retrieve existing progress metadata for this grammar rule from IndexedDB, or fallback to standard N5 defaults
        const currentProgress = grammarPointStore.state.peek().find(p => p.id === grammarPointId) || {
          id: grammarPointId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: new Date().toISOString()
        };

        const metrics = calculateSrsUpdate(
          {
            easeFactor: currentProgress.easeFactor,
            repetitions: currentProgress.repetitions,
            intervalDays: currentProgress.intervalDays,
          },
          isCorrect
        );

        yield* clientLog("info", `[StudySession] Recalculated SM-2 metrics for grammarPointId=${grammarPointId}:`, metrics);

        // Persist progress to local store
        yield* grammarPointStore.put({
          id: grammarPointId,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
        });

        // Enqueue queue transaction
        yield* enqueueTransaction("record_review", {
          grammarPointId,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
        });

        // Advance progress store indicator sequentially
        yield* Effect.sync(() => {
          activeSessionStore.next();
          const nextCard = activeSessionStore.currentCard.value;
          if (nextCard && typeof nextCard.audioUrl === "string") {
            _propose({ type: "PLAY_AUDIO", audioUrl: nextCard.audioUrl });
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

    if (isFinished) {
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
        <div class="flex items-center justify-between text-xs text-zinc-500">
          <span>Card ${currentIndex + 1} of ${cards.length}</span>
          <span>Progress: ${Math.round((currentIndex / cards.length) * 100)}%</span>
        </div>
        <div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div class="bg-green-500 h-full transition-all duration-300" style="width: ${(currentIndex / cards.length) * 100}%"></div>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-xl shadow-lg overflow-hidden min-h-[340px] flex flex-col justify-between p-8 space-y-6">
          <!-- The unified comprehension face of the card (displays context AND raw target immediately on the front) -->
          <div class="flex-1 flex flex-col justify-center items-center text-center space-y-6">
            <div class="space-y-2">
              <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Context</span>
              <p class="text-lg text-zinc-300">${currentCard.englishContext}</p>
            </div>

            <div class="space-y-3 w-full border-t border-zinc-900/60 pt-6">
              <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sentence (Furigana Rendering)</span>
              <div class="p-4 bg-zinc-900/40 border border-zinc-800/40 rounded-lg flex items-center justify-center">
                <furigana-sentence .segments=${currentCard.furigana}></furigana-sentence>
              </div>
            </div>

            ${currentCard.audioUrl
              ? html`
                  <button
                    @click=${() => this.controller.propose({ type: "PLAY_AUDIO", audioUrl: currentCard.audioUrl! })}
                    class="p-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded-full transition-colors border border-zinc-800 cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                    title="Play pronunciation audio"
                  >
                    🔊 Listen
                  </button>
                `
              : ""}
          </div>

          <!-- Single-click verification buttons -->
          <div class="pt-4 border-t border-zinc-900 flex justify-center">
            <div class="grid grid-cols-2 gap-4 w-full">
              <button
                @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", grammarPointId: currentCard.grammarPointId, isCorrect: false })}
                class="py-3 bg-red-650 hover:bg-red-600 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
              >
                Incorrect
              </button>
              <button
                @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", grammarPointId: currentCard.grammarPointId, isCorrect: true })}
                class="py-3 bg-green-650 hover:bg-green-600 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
              >
                Correct
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
