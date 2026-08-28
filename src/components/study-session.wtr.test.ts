import { html, fixture, expect } from "@open-wc/testing";
import "./StudySession";
import { StudySession } from "./StudySession";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore";
import { grammarPointStore } from "../lib/client/stores/grammarPointStore";
import { runClientPromise } from "../lib/client/runtime";

describe("StudySession Component - Comprehension-First Review Loop", () => {
  beforeEach(async () => {
    activeSessionStore.clear();
    await runClientPromise(grammarPointStore.clear());
  });

  it("should render finished state when study queue is empty", async () => {
    const el = await fixture<StudySession>(html`<study-session></study-session>`);
    
    const heading = el.querySelector("h2");
    expect(heading).to.exist;
    expect(heading?.textContent).to.contain("Review Completed!");
  });

  it("should render English context and reveal the Japanese sentence on request", async () => {
    // Load mock active study session
    activeSessionStore.loadSession([
      {
        knowledgePointId: "gp_tai",
        englishContext: "At a bar, wanting a beer.",
        japaneseSentence: "ビールを飲みたい",
        furigana: [
          { kanji: "ビール" },
          { kanji: "飲", kana: "の" },
          { kanji: "みたい" }
        ],
        audioUrl: null
      }
    ]);

    const el = await fixture<StudySession>(html`<study-session></study-session>`);

    // Check English priming context is visible directly on front
    const contextText = el.querySelector("p");
    expect(contextText).to.exist;
    expect(contextText?.textContent).to.contain("At a bar, wanting a beer.");

    const reveal = el.querySelector<HTMLButtonElement>('button[title="Toggle Japanese sentence (J)"]');
    expect(reveal).to.exist;
    reveal!.click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await el.updateComplete;

    // Check Furigana rendering element is present after the recall gate.
    const furiganaSentence = el.querySelector("furigana-sentence");
    expect(furiganaSentence).to.exist;
  });
});
