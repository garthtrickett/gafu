import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ReactiveSamController } from "../lib/client/reactive-sam-controller";
import { srsStore, SrsCardClient } from "../lib/client/stores/srsStore";
import { enqueueTransaction } from "../lib/client/sync/OutboxQueue";
import { clientLog } from "../lib/client/clientLog";
import { runClientUnscoped, type BaseClientContext } from "../lib/client/runtime";
import { navigate } from "../lib/client/router";
import { Effect } from "effect";

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
  readonly queue: readonly SrsCardClient[];
  readonly currentIndex: number;
  readonly showAnswer: boolean;
  readonly isFinished: boolean;
  readonly audioPlaying: boolean;
}

export type StudySessionAction =
  | { type: "INIT_QUEUE"; cards: readonly SrsCardClient[] }
  | { type: "REVEAL_ANSWER" }
  | { type: "PLAY_AUDIO"; audioUrl: string }
  | { type: "SUBMIT_GRADE"; cardId: string; isCorrect: boolean };

const initialModel: StudySessionModel = {
  queue: [],
  currentIndex: 0,
  showAnswer: false,
  isFinished: false,
  audioPlaying: false,
};

const update = (model: StudySessionModel, action: StudySessionAction): StudySessionModel => {
  switch (action.type) {
    case "INIT_QUEUE":
      return {
        ...model,
        queue: action.cards,
        currentIndex: 0,
        showAnswer: false,
        isFinished: action.cards.length === 0,
        audioPlaying: false,
      };
    case "REVEAL_ANSWER":
      return {
        ...model,
        showAnswer: true,
      };
    case "PLAY_AUDIO":
      return {
        ...model,
        audioPlaying: true,
      };
    case "SUBMIT_GRADE":
      const nextIndex = model.currentIndex + 1;
      const isFinished = nextIndex >= model.queue.length;
      return {
        ...model,
        currentIndex: nextIndex,
        showAnswer: false,
        isFinished,
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

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    const now = Date.now();
    const allCards = srsStore.state.value;
    let dueCards = allCards.filter(c => new Date(c.nextReview).getTime() <= now);

    if (dueCards.length === 0) {
      dueCards = allCards;
    }

    this.controller = new ReactiveSamController(
      this,
      { ...initialModel, queue: dueCards, isFinished: dueCards.length === 0 },
      update,
      (action, model, propose) => this.handleAction(action, model, propose)
    );

    super.connectedCallback();

        const firstCard = dueCards[0];
    if (firstCard && typeof firstCard.audioUrl === "string") {
      this.controller.propose({ type: "PLAY_AUDIO", audioUrl: firstCard.audioUrl });
    }
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
        const { cardId, isCorrect } = action;
        const currentCard = srsStore.state.peek().find(c => c.id === cardId);
        if (!currentCard) {
          yield* clientLog("error", `[StudySession] Graded card not found in store: ${cardId}`);
          return;
        }

        const metrics = calculateSrsUpdate(
          {
            easeFactor: currentCard.easeFactor,
            repetitions: currentCard.repetitions,
            intervalDays: currentCard.intervalDays,
          },
          isCorrect
        );

        yield* clientLog("info", "[StudySession] New SM-2 metrics calculated:", metrics);

        const updatedCard: SrsCardClient = {
          ...currentCard,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
        };
        yield* srsStore.put(updatedCard);

        yield* enqueueTransaction("record_review", {
          cardId,
          easeFactor: metrics.easeFactor,
          repetitions: metrics.repetitions,
          intervalDays: metrics.intervalDays,
          nextReview: metrics.nextReview,
        });

                                const nextCard = _model.queue[_model.currentIndex];
        if (nextCard && typeof nextCard.audioUrl === "string") {
          _propose({ type: "PLAY_AUDIO", audioUrl: nextCard.audioUrl });
        }
      }
    });

    return program.pipe(
      Effect.catchAll((err) =>
        clientLog("error", `[StudySession] Action execution failed for action: ${action.type}`, err)
      )
    );
  }

  override render() {
    const { queue, currentIndex, showAnswer, isFinished } = this.controller.model;

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
            class="px-6 py-2 bg-zinc-100 hover:bg-white text-zinc-900 font-medium rounded text-sm transition-colors"
          >
            Back to Study Desk
          </button>
        </div>
      `;
    }

    const currentCard = queue[currentIndex];
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
          <span>Card ${currentIndex + 1} of ${queue.length}</span>
          <span>Progress: ${Math.round((currentIndex / queue.length) * 100)}%</span>
        </div>
        <div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div class="bg-green-500 h-full transition-all duration-300" style="width: ${(currentIndex / queue.length) * 100}%"></div>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-xl shadow-lg overflow-hidden min-h-[300px] flex flex-col justify-between p-8 space-y-6">
          <div class="flex-1 flex flex-col justify-center items-center text-center space-y-6">
            <div class="space-y-2">
              <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Prompt / Front</span>
              <p class="text-2xl font-bold tracking-tight text-white">${currentCard.front}</p>
            </div>

            ${currentCard.audioUrl
              ? html`
                  <button
                    @click=${() => this.controller.propose({ type: "PLAY_AUDIO", audioUrl: currentCard.audioUrl! })}
                    class="p-3 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded-full transition-colors border border-zinc-800"
                    title="Play pronunciation audio"
                  >
                    🔊 Listen
                  </button>
                `
              : ""}

            ${showAnswer
              ? html`
                  <div class="w-full border-t border-zinc-800/60 pt-6 space-y-2">
                    <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Translation / Back</span>
                    <p class="text-xl font-bold text-green-400">${currentCard.back}</p>
                  </div>
                `
              : ""}
          </div>

          <div class="pt-4 border-t border-zinc-900 flex justify-center">
            ${!showAnswer
              ? html`
                  <button
                    @click=${() => this.controller.propose({ type: "REVEAL_ANSWER" })}
                    class="w-full py-3 bg-zinc-100 hover:bg-white text-zinc-900 font-bold rounded-lg transition-colors text-sm"
                  >
                    Reveal Answer
                  </button>
                `
              : html`
                  <div class="grid grid-cols-2 gap-4 w-full">
                    <button
                      @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", cardId: currentCard.id, isCorrect: false })}
                      class="py-3 bg-red-650 hover:bg-red-600 text-white font-bold rounded-lg transition-colors text-sm"
                    >
                      Incorrect
                    </button>
                    <button
                      @click=${() => this.controller.propose({ type: "SUBMIT_GRADE", cardId: currentCard.id, isCorrect: true })}
                      class="py-3 bg-green-650 hover:bg-green-600 text-white font-bold rounded-lg transition-colors text-sm"
                    >
                      Correct
                    </button>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }
}
