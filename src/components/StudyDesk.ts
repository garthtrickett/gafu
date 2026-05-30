import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { grammarPointStore, grammarPointCatalogStore } from "../lib/client/stores/grammarPointStore";
import { logout } from "../lib/client/stores/authStore";
import { generateExportPayload, importSessionPayload } from "../lib/client/stores/sessionSyncStore";
import { clientLog } from "../lib/client/clientLog";
import { runClientUnscoped } from "../lib/client/runtime";
import { navigate } from "../lib/client/router";
import { Effect } from "effect";

@customElement("study-desk")
export class StudyDesk extends LitElement {
  @state()
  private showQueue = false;

  @state()
  private pasteValue = "";

  @state()
  private importError: string | null = null;

  private _disposeEffect?: () => void;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    runClientUnscoped(grammarPointStore.load());
    runClientUnscoped(grammarPointCatalogStore.load());
    
    this._disposeEffect = effect(() => {
      const count = grammarPointStore.state.value.length;
      const catalogCount = grammarPointCatalogStore.state.value.length;
      runClientUnscoped(clientLog("info", `[StudyDesk] Store updated - progress count: ${count}, catalog count: ${catalogCount}`));
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  private triggerExport(e: Event) {
    const btn = e.target as HTMLButtonElement;
    const originalText = btn.textContent || "";
    btn.textContent = "⏱️ Compiling...";
    btn.disabled = true;

    runClientUnscoped(
      generateExportPayload().pipe(
        Effect.andThen(() => Effect.sync(() => {
          btn.textContent = "✅ Copied to Clipboard!";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);
        })),
        Effect.catchAll((err) => {
          btn.textContent = "❌ Failed to Copy";
          btn.disabled = false;
          return clientLog("error", "Export failed", err);
        })
      )
    );
  }

  private handleImport(e: Event) {
    e.preventDefault();
    this.importError = null;

    if (!this.pasteValue.trim()) {
      this.importError = "Please paste a valid session JSON payload.";
      return;
    }

    runClientUnscoped(
      importSessionPayload(this.pasteValue).pipe(
        Effect.andThen(() => navigate("study")),
        Effect.catchAll((err) => {
          this.importError = err instanceof Error ? err.message : String(err);
          return clientLog("error", "Import failed", err);
        })
      )
    );
  }

  private toggleQueue() {
    this.showQueue = !this.showQueue;
  }

  override render() {
    const catalog = grammarPointCatalogStore.state.value;
    const displayQueue = grammarPointStore.state.value.length > 0
      ? grammarPointStore.state.value.map(p => {
          const catalogItem = catalog.find(c => c.id === p.id);
          return {
            name: catalogItem ? catalogItem.formal_name : "は",
            repetitions: p.repetitions,
            nextReview: p.nextReview
          };
        })
      : [
          { name: "だ", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "です", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "は", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "も", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "に", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "で", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "を", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "が", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "から", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "まで", repetitions: 0, nextReview: new Date().toISOString() },
          { name: "と", repetitions: 0, nextReview: new Date().toISOString() }
        ];

    return html`
      <div class="max-w-4xl mx-auto space-y-6">
        <div class="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 class="text-2xl font-bold">Language Study Desk</h1>
            <p class="text-sm text-zinc-400">Review your active decks and vocabulary cycles.</p>
          </div>
          <button 
            @click=${logout}
            class="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded text-sm font-medium border border-zinc-800 transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <!-- Setup Wizard Deck Card (Manual Handshake Compiler) -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-5">
            <div>
              <h2 class="text-lg font-semibold text-zinc-200">Conversational Japanese</h2>
              <p class="text-sm text-zinc-400 mt-1">Essential survival phrases and foundational grammar.</p>
            </div>

            <div class="space-y-4 pt-2 border-t border-zinc-900">
              <div class="space-y-2">
                <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">1. Export Progress</span>
                <button 
                  @click=${this.triggerExport}
                  class="w-full py-2.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-100 hover:text-white font-medium rounded text-sm transition-colors cursor-pointer border border-zinc-800 flex items-center justify-center gap-2"
                >
                  📋 Copy Progress Payload
                </button>
                <p class="text-2xs text-zinc-500">Copies your due N5 progress rules so the AI can compile matching cards.</p>
              </div>

              <form @submit=${this.handleImport} class="space-y-2 pt-2 border-t border-zinc-900">
                <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">2. Import Session</span>
                <textarea
                  @input=${(e: Event) => { this.pasteValue = (e.target as HTMLTextAreaElement).value; }}
                  placeholder="Paste the compiled JSON session payload here..."
                  class="w-full h-24 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 text-xs font-mono"
                ></textarea>
                
                ${this.importError ? html`<p class="text-xs text-red-400 font-medium">${this.importError}</p>` : ""}

                <button 
                  type="submit"
                  class="w-full py-2.5 bg-green-650 hover:bg-green-600 text-white font-bold rounded text-sm transition-colors cursor-pointer"
                >
                  🚀 Import & Start Study
                </button>
              </form>
            </div>
          </div>

          <!-- Study Progress / Stats Card -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <h2 class="text-lg font-semibold text-zinc-200">Study Progress</h2>
              <div class="space-y-3 text-sm text-zinc-400 mt-4">
                <div class="flex justify-between border-b border-zinc-900 pb-2">
                  <span>Total Studied Rules</span>
                  <span class="text-zinc-200 font-semibold">N5 Catalog Active</span>
                </div>
                <div class="flex justify-between border-b border-zinc-900 pb-2">
                  <span>Sync Outbox Queue</span>
                  <span class="text-zinc-200">Local-first enabled</span>
                </div>
              </div>

              <button 
                @click=${this.toggleQueue}
                class="w-full mt-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded text-xs font-medium border border-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                ${this.showQueue ? "🙈 Hide Active Queue" : "👁️ View Active Queue"}
              </button>

              ${this.showQueue ? html`
                <div class="mt-4 p-3 bg-zinc-900/60 border border-zinc-900 rounded-lg space-y-2 animate-fade-in">
                  <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Due Queue (${displayQueue.length} rules)</span>
                  <div class="divide-y divide-zinc-900/80 max-h-40 overflow-y-auto pr-1">
                    ${displayQueue.map(item => html`
                      <div class="py-2 flex items-center justify-between text-xs">
                        <div class="flex items-center gap-2">
                          <span class="px-1.5 py-0.5 bg-zinc-850 text-green-400 font-bold rounded border border-zinc-800">${item.name}</span>
                          <span class="text-zinc-500">Reps: ${item.repetitions}</span>
                        </div>
                        <span class="text-zinc-500">Next: ${new Date(item.nextReview).toLocaleDateString()}</span>
                      </div>
                    `)}
                  </div>
                </div>
              ` : ""}
            </div>
            <div class="p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg text-xs text-zinc-400 leading-relaxed">
              💡 <strong>Handshake Flow</strong>: Click \"Copy Progress\", paste it to your language tutor bot to generate your daily review cards, then paste the returned JSON back here to review with zero latency.
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
