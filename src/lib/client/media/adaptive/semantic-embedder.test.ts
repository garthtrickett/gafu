import { describe, expect, it } from "vitest";
import { splitEmbeddingRows } from "./semantic-embedder.ts";

describe("local semantic embedding compression", () => {
  it("splits a batched tensor without retaining model output objects", () => {
    const rows = splitEmbeddingRows({ data: Float32Array.of(1, 2, 3, 4, 5, 6), dims: [2, 3] }, 2);
    expect(rows.map((row) => [...row])).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(splitEmbeddingRows({ data: Float32Array.of(1, 2, 3), dims: [1, 3] }, 2)).toEqual([]);
  });
});
