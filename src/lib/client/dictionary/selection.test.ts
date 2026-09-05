import { describe, it, expect, afterEach } from "vitest";
import { clearSelection, readSelectedBaseText } from "./selection.ts";

const mountFuriganaSentence = (): HTMLElement => {
  const container = document.createElement("div");
  container.id = "japanese-sentence";
  container.innerHTML = `
    <span><ruby>食<rt>た</rt></ruby><span>べる</span><ruby>物<rt>もの</rt></ruby><span>です</span></span>
  `;
  document.body.appendChild(container);
  return container;
};

const selectBetween = (start: Node, startOffset: number, end: Node, endOffset: number): Selection => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("readSelectedBaseText", () => {
  it("drops ruby readings so the kanji base text survives", () => {
    const container = mountFuriganaSentence();
    const kanji = container.querySelector("ruby")!.firstChild!;
    const okurigana = container.querySelectorAll("span > span")[0]!.firstChild!;

    const selection = selectBetween(kanji, 0, okurigana, 2);

    expect(selection.toString()).toContain("た");
    expect(readSelectedBaseText(selection, container)).toBe("食べる");
  });

  it("reads a selection that spans several ruby blocks", () => {
    const container = mountFuriganaSentence();
    const first = container.querySelector("ruby")!.firstChild!;
    const last = container.querySelectorAll("span > span")[1]!.firstChild!;

    const selection = selectBetween(first, 0, last, 2);

    expect(readSelectedBaseText(selection, container)).toBe("食べる物です");
  });

  it("returns null for a collapsed selection", () => {
    const container = mountFuriganaSentence();
    const kanji = container.querySelector("ruby")!.firstChild!;

    const selection = selectBetween(kanji, 0, kanji, 0);

    expect(readSelectedBaseText(selection, container)).toBeNull();
  });

  it("returns null when only a furigana reading is highlighted", () => {
    const container = mountFuriganaSentence();
    const reading = container.querySelector("rt")!.firstChild!;

    const selection = selectBetween(reading, 0, reading, 1);

    expect(readSelectedBaseText(selection, container)).toBeNull();
  });

  it("returns null when a whole furigana annotation is highlighted", () => {
    const container = mountFuriganaSentence();
    const reading = container.querySelector("rt")!;

    const range = document.createRange();
    range.selectNode(reading);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelectedBaseText(selection, container)).toBeNull();
  });

  it("reads the base text of a ruby block selected as a whole", () => {
    const container = mountFuriganaSentence();
    const ruby = container.querySelector("ruby")!;

    const range = document.createRange();
    range.selectNode(ruby);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(readSelectedBaseText(selection, container)).toBe("食");
  });

  it("ignores a highlight made outside the sentence", () => {
    const container = mountFuriganaSentence();
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "English context";
    document.body.appendChild(elsewhere);

    const selection = selectBetween(elsewhere.firstChild!, 0, elsewhere.firstChild!, 7);

    expect(readSelectedBaseText(selection, container)).toBeNull();
  });

  it("returns null when there is no selection at all", () => {
    const container = mountFuriganaSentence();
    expect(readSelectedBaseText(null, container)).toBeNull();
  });
});

describe("clearSelection", () => {
  it("removes the active range and tolerates a missing selection", () => {
    const container = mountFuriganaSentence();
    const kanji = container.querySelector("ruby")!.firstChild!;
    const selection = selectBetween(kanji, 0, kanji, 1);

    clearSelection(selection);

    expect(selection.rangeCount).toBe(0);
    expect(() => clearSelection(null)).not.toThrow();
  });
});

describe("readSelectedBaseText in the subtitle overlay", () => {
  // The overlay renders furigana as a positioned span rather than ruby, and
  // excludes it from selection in CSS. jsdom applies no CSS, so this proves the
  // reader strips it structurally too.
  const mountSubtitleLine = (): HTMLElement => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-subtitle-overlay", "");
    overlay.innerHTML = `<div data-subtitle-line><span data-subtitle-token><span data-subtitle-reading>ねん</span><span data-subtitle-surface>年</span></span><span data-subtitle-token><span data-subtitle-reading>まつ</span><span data-subtitle-surface>末</span></span><span data-subtitle-token><span data-subtitle-surface>には</span></span></div>`;
    document.body.appendChild(overlay);
    return overlay;
  };

  it("drops the subtitle readings and keeps the surface text", () => {
    const overlay = mountSubtitleLine();
    const line = overlay.querySelector("[data-subtitle-line]")!;

    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(selection.toString()).toContain("ねん");
    expect(readSelectedBaseText(selection, overlay)).toBe("年末には");
  });

  it("returns null when only a subtitle reading is highlighted", () => {
    const overlay = mountSubtitleLine();
    const reading = overlay.querySelector("[data-subtitle-reading]")!.firstChild!;

    const selection = selectBetween(reading, 0, reading, 2);

    expect(readSelectedBaseText(selection, overlay)).toBeNull();
  });

  it("reads a partial drag across two subtitle tokens", () => {
    const overlay = mountSubtitleLine();
    const first = overlay.querySelectorAll("[data-subtitle-surface]")[0]!.firstChild!;
    const second = overlay.querySelectorAll("[data-subtitle-surface]")[1]!.firstChild!;

    const selection = selectBetween(first, 0, second, 1);

    expect(readSelectedBaseText(selection, overlay)).toBe("年末");
  });
});
