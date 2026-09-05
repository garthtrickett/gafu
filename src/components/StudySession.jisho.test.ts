import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "./StudySession";
import { StudySession } from "./StudySession";
import { activeSessionStore } from "../lib/client/stores/activeSessionStore";
import { tokenState } from "../lib/client/stores/authStore";

const settle = async (element: StudySession) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await element.updateComplete;
};

const jishoPayload = {
  success: true,
  data: {
    term: "食",
    entries: [
      {
        slug: "食",
        isCommon: true,
        jlpt: [],
        forms: [{ word: "食", reading: "しょく" }],
        senses: [{ englishDefinitions: ["food"], partsOfSpeech: ["Noun"], tags: [], seeAlso: [] }],
      },
    ],
  },
};

const loadJapaneseCard = () => {
  activeSessionStore.loadSession([
    {
      knowledgePointId: "gp-jisho",
      englishContext: "Talking about a meal.",
      japaneseSentence: "食べる",
      furigana: [
        { kanji: "食", kana: "た" },
        { kanji: "べる" },
      ],
      audioUrl: null,
    },
  ]);
};

// Highlights the kanji base text inside the revealed sentence and lets the
// document-level mouseup listener pick the selection up.
const highlightFirstKanji = (element: StudySession) => {
  const ruby = element.querySelector("#japanese-sentence ruby")!;
  const range = document.createRange();
  range.selectNode(ruby);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
};

describe("StudySession Jisho lookups", () => {
  let element: StudySession;
  let fetchMock: ReturnType<typeof vi.fn>;

  // clientLog shares the stubbed global fetch, so only the dictionary requests
  // are counted here.
  const jishoCalls = (): unknown[][] =>
    fetchMock.mock.calls.filter(
      (call): call is unknown[] => typeof call[0] === "string" && call[0].startsWith("/api/jisho"),
    );

  beforeEach(async () => {
    activeSessionStore.clear();
    tokenState.value = "test-token";
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(jishoPayload),
      } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    element = document.createElement("study-session") as StudySession;
    document.body.appendChild(element);
    loadJapaneseCard();
    await element.updateComplete;

    (element as unknown as { controller: { propose: (a: unknown) => void } }).controller.propose({
      type: "TOGGLE_JAPANESE",
    });
    await settle(element);
  });

  afterEach(() => {
    element.remove();
    window.getSelection()?.removeAllRanges();
    activeSessionStore.clear();
    tokenState.value = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the modal with the Jisho entry for a highlighted word", async () => {
    highlightFirstKanji(element);
    await settle(element);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jisho/search?keyword=%E9%A3%9F",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );

    const modal = element.querySelector("jisho-lookup-modal");
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain("food");
  });

  it("ignores a highlight of the English context", async () => {
    const context = element.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(context);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await settle(element);

    expect(jishoCalls()).toHaveLength(0);
    expect(element.querySelector("jisho-lookup-modal")).toBeNull();
  });

  it("shows the failure reason when the lookup cannot be served", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        (url.startsWith("/api/jisho")
          ? { ok: false, status: 502, json: () => Promise.resolve({}) }
          : { ok: true, status: 200, json: () => Promise.resolve({ success: true }) }) as unknown as Response,
      ),
    );

    highlightFirstKanji(element);
    await settle(element);

    const modal = element.querySelector("jisho-lookup-modal");
    expect(modal?.textContent).toContain("Jisho could not be reached right now.");
  });

  it("closes the modal on Escape without grading the card", async () => {
    highlightFirstKanji(element);
    await settle(element);
    expect(element.querySelector("jisho-lookup-modal")).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(element);

    expect(element.querySelector("jisho-lookup-modal")).toBeNull();
    expect(activeSessionStore.currentIndex.value).toBe(0);
  });

  it("suppresses the grading shortcuts while the modal is open", async () => {
    highlightFirstKanji(element);
    await settle(element);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    await settle(element);

    expect(element.querySelector("jisho-lookup-modal")).not.toBeNull();
    expect(activeSessionStore.currentIndex.value).toBe(0);
  });

  it("closes the modal when the lookup is dismissed from the dialog", async () => {
    highlightFirstKanji(element);
    await settle(element);

    element.querySelector<HTMLButtonElement>("#jisho-lookup-close")!.click();
    await settle(element);

    expect(element.querySelector("jisho-lookup-modal")).toBeNull();
  });

  it("does not look up again while a modal is already open", async () => {
    highlightFirstKanji(element);
    await settle(element);
    expect(jishoCalls()).toHaveLength(1);

    highlightFirstKanji(element);
    await settle(element);
    expect(jishoCalls()).toHaveLength(1);
  });
});
