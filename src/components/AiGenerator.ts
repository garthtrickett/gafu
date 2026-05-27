import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ReactiveSamController } from "../lib/client/reactive-sam-controller";
import { tokenState } from "../lib/client/stores/authStore";
import { deckStore } from "../lib/client/stores/deckStore";
import { srsStore } from "../lib/client/stores/srsStore";
import { enqueueTransaction } from "../lib/client/sync/OutboxQueue";
import { clientLog } from "../lib/client/clientLog";
import { runClientUnscoped, runClientPromise, type BaseClientContext } from "../lib/client/runtime";
import { navigate } from "../lib/client/router";
import { Effect } from "effect";
import type { SentenceGeneration } from "../lib/server/ai/schema";
import "./FuriganaSentence";

export interface AiGeneratorModel {
  readonly prompt: string;
  readonly isGenerating: boolean;
  readonly generatedCard: SentenceGeneration | null;
  readonly error: string | null;
  readonly skin: "none" | "anime" | "business" | "travel" | "daily";
}

export type AiGeneratorAction =
  | { type: "UPDATE_PROMPT"; prompt: string }
  | { type: "CHANGE_SKIN"; skin: AiGeneratorModel["skin"] }
  | { type: "START_GENERATION" }
  | { type: "GENERATION_SUCCESS"; data: SentenceGeneration }
  | { type: "GENERATION_ERROR"; error: string }
  | { type: "RESET_GENERATION" };

const initialModel: AiGeneratorModel = {
  prompt: "",
  isGenerating: false,
  generatedCard: null,
  error: null,
  skin: "none",
};

const update = (model: AiGeneratorModel, action: AiGeneratorAction): AiGeneratorModel => {
  switch (action.type) {
    case "UPDATE_PROMPT":
      return { ...model, prompt: action.prompt };
    case "CHANGE_SKIN":
      return { ...model, skin: action.skin };
    case "START_GENERATION":
      return { ...model, isGenerating: true, error: null, generatedCard: null };
    case "GENERATION_SUCCESS":
      return { ...model, isGenerating: false, generatedCard: action.data };
    case "GENERATION_ERROR":
      return { ...model, isGenerating: false, error: action.error };
    case "RESET_GENERATION":
      return { ...model, prompt: "", generatedCard: null, error: null };
    default:
      return model;
  }
};

@customElement("ai-generator")
export class AiGenerator extends LitElement {
  private controller!: ReactiveSamController<this, AiGeneratorModel, AiGeneratorAction, never, BaseClientContext>;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    this.controller = new ReactiveSamController(
      this,
      initialModel,
      update,
      (action, model, propose) => this.handleAction(action, model, propose)
    );
    super.connectedCallback();
  }

    private handleAction(
    action: AiGeneratorAction,
    model: AiGeneratorModel,
    propose: (action: AiGeneratorAction) => void
  ): Effect.Effect<void, never, BaseClientContext> {
    return Effect.gen(function* () {
      yield* clientLog("info", `[AiGenerator] SAM action hook: ${action.type}`);

      if (action.type === "START_GENERATION") {
        const token = tokenState.value;
        if (!token) {
          propose({ type: "GENERATION_ERROR", error: "Your session has expired. Please log in again." });
          return;
        }

        let promptText = model.prompt;
        if (model.skin !== "none") {
          promptText = `Context / Skin [${model.skin.toUpperCase()} STYLE]: ${model.prompt}`;
        }

        yield* clientLog("info", `[AiGenerator] Invoking Elysia generation endpoint: "${promptText}"`);

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch("/api/ai/generate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ prompt: promptText }),
            }),
          catch: (err) => new Error(`HTTP request failed: ${String(err)}`),
        });

        if (!response.ok) {
          propose({ type: "GENERATION_ERROR", error: `Mastra AI returned error status ${response.status}` });
          return;
        }

        const payload = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ success: boolean; data: SentenceGeneration; error?: string }>,
          catch: (err) => new Error(`Failed to parse structured JSON: ${String(err)}`),
        });

        if (payload.success && payload.data) {
          propose({ type: "GENERATION_SUCCESS", data: payload.data });
        } else {
          propose({ type: "GENERATION_ERROR", error: payload.error || "Mastra response is malformed." });
        }
      }
    }).pipe(
      Effect.catchAll((err) =>
        clientLog("error", `[AiGenerator] Action execution failed for ${action.type}`, err)
      )
    );
  }

  private async handleSaveCard() {
    const generated = this.controller.model.generatedCard;
    if (!generated) return;

    const defaultDeckId = deckStore.state.value[0]?.id || "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33";
    const cardId = crypto.randomUUID();

    const srsCardData = {
      id: cardId,
      user_id: "",
      deck_id: defaultDeckId,
      front: generated.front,
      back: generated.back,
      easeFactor: 2.5,
      repetitions: 0,
      intervalDays: 0,
      nextReview: new Date().toISOString(),
    };

    await runClientPromise(
      Effect.gen(function* () {
        yield* clientLog("info", `[AiGenerator] Storing generated card in offline store, ID: ${cardId}`);
        yield* srsStore.put(srsCardData);

        yield* clientLog("info", "[AiGenerator] Enqueuing record_review outbox transaction for background sync...");
        yield* enqueueTransaction("record_review", {
          cardId,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 0,
          nextReview: srsCardData.nextReview,
        });

        yield* clientLog("info", "[AiGenerator] Save sequence successfully completed. Routing home.");
        yield* navigate("/");
      })
    );
  }

  override render() {
    const { prompt, isGenerating, generatedCard, error, skin } = this.controller.model;

    return html`
      <div class="max-w-xl mx-auto space-y-6">
        <div class="border-b border-zinc-800 pb-4 flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold">AI Contextual Generator</h1>
            <p class="text-sm text-zinc-400">Leverage Mastra LLM to compose colloquial, localized conversational sentences on the fly.</p>
          </div>
          <button
            @click=${() => runClientUnscoped(navigate("/"))}
            class="px-3 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded text-sm font-medium border border-zinc-800 transition-colors cursor-pointer"
          >
            Back to Desk
          </button>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6 shadow-md">
          <!-- Scenario prompt input -->
          <div class="space-y-2">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Scenario Prompt</label>
            <textarea
              .value=${prompt}
              @input=${(e: Event) => this.controller.propose({ type: "UPDATE_PROMPT", prompt: (e.target as HTMLTextAreaElement).value })}
              placeholder="e.g. Asking the barista for a recommendation because it is my first time visiting this Kyoto cafe."
              class="w-full h-24 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-green-500 text-sm"
              ?disabled=${isGenerating}
            ></textarea>
          </div>

          <!-- Vocabulary Skin selection -->
          <div class="space-y-2">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Thematic Skin</label>
            <div class="grid grid-cols-5 gap-2">
              ${(["none", "anime", "business", "travel", "daily"] as const).map(
                (s) => html`
                  <button
                    @click=${() => this.controller.propose({ type: "CHANGE_SKIN", skin: s })}
                    class="py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${skin === s
                      ? "bg-green-500/10 border-green-500 text-green-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"}"
                    ?disabled=${isGenerating}
                  >
                    ${s.toUpperCase()}
                  </button>
                `
              )}
            </div>
          </div>

          <!-- Generator execution trigger -->
          <button
            @click=${() => this.controller.propose({ type: "START_GENERATION" })}
            class="w-full py-3 bg-zinc-100 hover:bg-white text-zinc-900 font-bold rounded-lg transition-colors text-sm flex items-center justify-center gap-2 cursor-pointer"
            ?disabled=${isGenerating || !prompt.trim()}
          >
            ${isGenerating
              ? html`<span class="animate-spin rounded-full h-4 w-4 border-2 border-zinc-900 border-t-transparent"></span> Generation in progress...`
              : "Generate sentence with Mastra AI"}
          </button>

          ${error ? html`<div class="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">${error}</div>` : ""}
        </div>

        <!-- Output display panel -->
        ${generatedCard
          ? html`
              <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6 shadow-md animate-fade-in">
                <h3 class="text-sm font-bold text-zinc-400 border-b border-zinc-800 pb-2">Structured Output Preview</h3>
                
                <div class="space-y-4">
                  <div>
                    <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Context (Front)</span>
                    <p class="text-sm text-zinc-300 mt-1">${generatedCard.front}</p>
                  </div>

                  <div>
                    <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Colloquial (Back)</span>
                    <p class="text-sm text-zinc-300 mt-1">${generatedCard.back}</p>
                  </div>

                  <div>
                    <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Rendering (Furigana Ruby Tags)</span>
                    <div class="mt-2 p-4 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center">
                      <furigana-sentence .segments=${generatedCard.furigana}></furigana-sentence>
                    </div>
                  </div>
                </div>

                                <button
                  @click=${() => this.handleSaveCard()}
                  class="w-full py-3 bg-green-650 hover:bg-green-600 text-white font-bold rounded-lg transition-colors text-sm cursor-pointer"
                >
                  Add to Study Desk
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
