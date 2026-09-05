// File: src/components/JishoLookupModal.ts
// ------------------------------------------------------------------------------
// Jisho.org lookup modal for a highlighted Japanese word
// ------------------------------------------------------------------------------
import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { jishoWebUrl, type JishoEntry, type JishoLookupResult } from "../lib/shared/jisho.ts";

export type JishoLookupStatus = "loading" | "loaded" | "error";

@customElement("jisho-lookup-modal")
export class JishoLookupModal extends LitElement {
  @property({ type: String })
  term = "";

  @property({ type: String })
  status: JishoLookupStatus = "loading";

  @property({ type: Object })
  result: JishoLookupResult | null = null;

  @property({ type: String })
  message = "";

  protected override createRenderRoot() {
    return this;
  }

  private requestClose = () => {
    this.dispatchEvent(new CustomEvent("jisho-close", { bubbles: true, composed: true }));
  };

  private renderForms(entry: JishoEntry) {
    const primary = entry.forms[0];
    const alternates = entry.forms.slice(1).filter((form) => form.word || form.reading);

    return html`
      <div class="space-y-1">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-2xl text-white">${primary?.word ?? entry.slug}</span>
          ${primary?.reading
            ? html`<span class="text-sm text-green-400">${primary.reading}</span>`
            : nothing}
          ${entry.isCommon
            ? html`<span class="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-400">Common</span>`
            : nothing}
          ${entry.jlpt.map(
            (level) => html`<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">${level.replace("jlpt-", "")}</span>`,
          )}
        </div>
        ${alternates.length > 0
          ? html`
              <p class="text-xs text-zinc-500">
                Other forms:
                ${alternates
                  .map((form) => (form.reading && form.word ? `${form.word}【${form.reading}】` : form.word ?? form.reading))
                  .join("、")}
              </p>
            `
          : nothing}
      </div>
    `;
  }

  private renderEntry(entry: JishoEntry) {
    return html`
      <li class="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        ${this.renderForms(entry)}
        <ol class="space-y-2">
          ${entry.senses.map(
            (sense, index) => html`
              <li class="space-y-1">
                ${sense.partsOfSpeech.length > 0
                  ? html`<p class="text-[11px] uppercase tracking-wider text-zinc-500">${sense.partsOfSpeech.join(", ")}</p>`
                  : nothing}
                <p class="text-sm leading-relaxed text-zinc-200">
                  <span class="text-zinc-500">${index + 1}.</span>
                  ${sense.englishDefinitions.join("; ")}
                </p>
                ${sense.tags.length > 0
                  ? html`<p class="text-[11px] text-amber-300/80">${sense.tags.join(", ")}</p>`
                  : nothing}
                ${sense.seeAlso.length > 0
                  ? html`<p class="text-[11px] text-zinc-500">See also: ${sense.seeAlso.join("、")}</p>`
                  : nothing}
              </li>
            `,
          )}
        </ol>
      </li>
    `;
  }

  private renderBody() {
    if (this.status === "loading") {
      return html`
        <p id="jisho-lookup-body" class="py-8 text-center text-sm text-zinc-400">
          Looking up <span class="text-zinc-200">${this.term}</span> on Jisho…
        </p>
      `;
    }

    if (this.status === "error") {
      return html`
        <p id="jisho-lookup-body" role="alert" class="py-8 text-center text-sm text-amber-200">
          ${this.message || "The dictionary lookup failed."}
        </p>
      `;
    }

    const entries = this.result?.entries ?? [];
    if (entries.length === 0) {
      return html`
        <p id="jisho-lookup-body" class="py-8 text-center text-sm text-zinc-400">
          Jisho has no entry for <span class="text-zinc-200">${this.term}</span>. Try highlighting a
          shorter part of the word.
        </p>
      `;
    }

    return html`
      <ul id="jisho-lookup-body" class="space-y-3">
        ${entries.map((entry) => this.renderEntry(entry))}
      </ul>
    `;
  }

  override render() {
    return html`
      <div
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
        @click=${this.requestClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jisho-lookup-title"
          class="max-h-[80vh] w-full max-w-lg animate-fade-in overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <div>
              <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Jisho</span>
              <h2 id="jisho-lookup-title" class="text-xl font-bold text-white">${this.term}</h2>
            </div>
            <button
              type="button"
              id="jisho-lookup-close"
              @click=${this.requestClose}
              class="shrink-0 cursor-pointer rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-850 hover:text-white"
              aria-label="Close dictionary lookup"
              aria-keyshortcuts="Escape"
            >
              Close <kbd class="text-zinc-500">Esc</kbd>
            </button>
          </div>

          ${this.renderBody()}

          <a
            href=${jishoWebUrl(this.term)}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-4 inline-block text-xs text-green-400 hover:text-green-300"
          >
            Open ${this.term} on jisho.org ↗
          </a>
        </div>
      </div>
    `;
  }
}
