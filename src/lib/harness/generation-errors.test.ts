import { describe, expect, test } from "bun:test";
import { GeneratedScadCompileError } from "@/lib/harness/generation-errors";
import type { StructuredGenerationResult } from "@/lib/harness/types";

const generationResult = {
  scad_source: "cube([1, 1, 1]);",
} as StructuredGenerationResult;

describe("GeneratedScadCompileError", () => {
  test("preserves an Error cause and its compiler diagnostic", () => {
    const cause = new Error("CGAL assertion violation");
    const error = new GeneratedScadCompileError(generationResult, cause);

    expect(error.name).toBe("GeneratedScadCompileError");
    expect(error.cause).toBe(cause);
    expect(error.compileLog).toBe("CGAL assertion violation");
    expect(error.generationResult).toBe(generationResult);
  });

  test("normalizes a non-Error compiler rejection without inventing a cause", () => {
    const error = new GeneratedScadCompileError(generationResult, "renderer rejected source");

    expect(error.compileLog).toBe("renderer rejected source");
    expect(error.cause).toBeUndefined();
  });
});
