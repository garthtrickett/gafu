import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { FuriganaSegment } from "../lib/server/ai/schema";

@customElement("furigana-sentence")
export class FuriganaSentence extends LitElement {
  @property({ type: Array })
  segments: FuriganaSegment[] = [];

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    if (!this.segments || this.segments.length === 0) {
      return html``;
    }

    return html`
      <span class="inline-flex flex-wrap gap-x-1 items-end leading-loose text-2xl text-white">
        ${this.segments.map((segment) => {
          if (segment.kana) {
            return html`
              <ruby class="ruby-align">
                ${segment.kanji}
                <rt class="text-xs text-green-400 select-none pb-0.5">${segment.kana}</rt>
              </ruby>
            `;
          }
          return html`<span>${segment.kanji}</span>`;
        })}
      </span>
    `;
  }
}
