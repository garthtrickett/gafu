import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./JishoLookupModal";
import { JishoLookupModal } from "./JishoLookupModal";
import type { JishoLookupResult } from "../lib/shared/jisho.ts";

const result: JishoLookupResult = {
  term: "食べる",
  entries: [
    {
      slug: "食べる",
      isCommon: true,
      jlpt: ["jlpt-n5"],
      forms: [
        { word: "食べる", reading: "たべる" },
        { word: "喰べる", reading: "たべる" },
      ],
      senses: [
        {
          englishDefinitions: ["to eat"],
          partsOfSpeech: ["Ichidan verb", "Transitive verb"],
          tags: [],
          seeAlso: ["食う"],
        },
      ],
    },
  ],
};

describe("JishoLookupModal", () => {
  let element: JishoLookupModal;

  beforeEach(() => {
    element = document.createElement("jisho-lookup-modal") as JishoLookupModal;
    element.term = "食べる";
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("announces the pending lookup while it is loading", async () => {
    element.status = "loading";
    await element.updateComplete;

    expect(element.querySelector("[role='dialog']")).not.toBeNull();
    expect(element.textContent).toContain("Looking up");
  });

  it("renders the readings, tags and senses of a loaded entry", async () => {
    element.status = "loaded";
    element.result = result;
    await element.updateComplete;

    const text = element.textContent ?? "";
    expect(text).toContain("たべる");
    expect(text).toContain("to eat");
    expect(text).toContain("Ichidan verb, Transitive verb");
    expect(text).toContain("Common");
    expect(text).toContain("n5");
    expect(text).toContain("喰べる【たべる】");
    expect(text).toContain("See also: 食う");
  });

  it("explains an empty result instead of rendering a blank dialog", async () => {
    element.status = "loaded";
    element.result = { term: "食べる", entries: [] };
    await element.updateComplete;

    expect(element.textContent).toContain("Jisho has no entry for");
  });

  it("surfaces a failure message as an alert", async () => {
    element.status = "error";
    element.message = "Jisho could not be reached right now.";
    await element.updateComplete;

    const alert = element.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Jisho could not be reached right now.");
  });

  it("links out to the term on jisho.org", async () => {
    element.status = "loaded";
    element.result = result;
    await element.updateComplete;

    const link = element.querySelector<HTMLAnchorElement>("a[href^='https://jisho.org/search/']");
    expect(link?.href).toBe("https://jisho.org/search/%E9%A3%9F%E3%81%B9%E3%82%8B");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("emits jisho-close from the close button and the backdrop", async () => {
    element.status = "loading";
    await element.updateComplete;

    let closes = 0;
    element.addEventListener("jisho-close", () => {
      closes += 1;
    });

    element.querySelector<HTMLButtonElement>("#jisho-lookup-close")!.click();
    expect(closes).toBe(1);

    element.querySelector<HTMLElement>(".fixed")!.click();
    expect(closes).toBe(2);
  });

  it("does not close when the dialog body itself is clicked", async () => {
    element.status = "loading";
    await element.updateComplete;

    let closes = 0;
    element.addEventListener("jisho-close", () => {
      closes += 1;
    });

    element.querySelector<HTMLElement>("[role='dialog']")!.click();
    expect(closes).toBe(0);
  });
});
