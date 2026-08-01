import { describe, expect, test } from "bun:test";

import { retrieveContext } from "./example-retriever";

describe("example retriever", () => {
  test("returns honest empty design context for an unmatched request", async () => {
    const context = await retrieveContext("行星发动机模型");
    expect(context.examples).toEqual([]);
    expect(context.patterns).toEqual([]);
    expect(context.matchedKeywords).toEqual([]);
    expect(context.failures.map((item) => item.name).sort()).toEqual([
      "floating_parts",
      "missing_holes",
      "non_manifold_boolean",
    ]);
  });

  test("returns only keyword-supported examples and patterns", async () => {
    const context = await retrieveContext("Create a reinforced wall bracket with mounting holes");
    expect(context.examples.map((item) => item.name).sort()).toEqual([
      "l_bracket_ribs",
      "ribbed_mount",
    ]);
    expect(context.patterns.map((item) => item.name).sort()).toEqual([
      "bracket_patterns",
      "hole_patterns",
      "printable_rules",
    ]);
    expect(context.matchedKeywords).toContain("bracket");
    expect(context.matchedKeywords).toContain("mounting");
  });
});
