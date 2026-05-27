import { expect } from "@open-wc/testing";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("Web Test Runner Smoke Test", () => {
  it("should successfully run in the browser", () => {
    expect(true).to.be.true;
  });
});
