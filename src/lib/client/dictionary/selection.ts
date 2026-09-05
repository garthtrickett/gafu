// File: src/lib/client/dictionary/selection.ts
// ------------------------------------------------------------------------------
// Reads the base text a learner highlighted inside a furigana sentence.
// ------------------------------------------------------------------------------
// A furigana annotation is real text, so `Selection.toString()` interleaves the
// kana readings with the kanji ("食たべる"). Cloning the range and dropping the
// annotation elements recovers the word the learner actually dragged over.
//
// The study session renders furigana as ruby; the subtitle overlay renders it as
// a positioned span it excludes from selection in CSS. Stripping both here keeps
// one code path and does not depend on `user-select` to have been applied.
const FURIGANA_ANNOTATION = "rt, rp, [data-subtitle-reading]";

// A range that ends inside an annotation still clones the enclosing <rt>, so the
// only reading that survives the strip is one selected entirely within it. Those
// are refused too, which keeps "highlight the word, not its furigana" honest for
// every drag rather than just the ones that cross an element boundary.
const isWithinFuriganaAnnotation = (node: Node): boolean => {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(FURIGANA_ANNOTATION) != null;
};

export const readSelectedBaseText = (
  selection: Selection | null,
  container: Element,
): string | null => {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  if (isWithinFuriganaAnnotation(range.commonAncestorContainer)) return null;

  const fragment = range.cloneContents();
  for (const annotation of Array.from(fragment.querySelectorAll(FURIGANA_ANNOTATION))) {
    annotation.remove();
  }
  const text = fragment.textContent;
  return text && text.trim().length > 0 ? text : null;
};

export const clearSelection = (selection: Selection | null): void => {
  selection?.removeAllRanges();
};
