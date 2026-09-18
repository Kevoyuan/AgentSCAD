import { describe, expect, test } from "bun:test";

import { retrieveContext } from "./example-retriever";
import { RETRIEVAL_BUDGET } from "./retrieval-index";

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

  test("retrieves for a Chinese request without an English keyword in it", async () => {
    const context = await retrieveContext("帮我做一个墙上安装的L型支架，带安装孔");
    expect(context.examples.map((item) => item.name)).toEqual(["l_bracket_ribs"]);
    expect(context.patterns.map((item) => item.name).sort()).toEqual([
      "bracket_patterns",
      "hole_patterns",
    ]);
    expect(context.matchedKeywords).toContain("l型支架");
    expect(context.matchedKeywords).toContain("安装孔");
  });

  test("ranks by weighted alias match instead of returning a flat relevance", async () => {
    const context = await retrieveContext("Create a reinforced wall bracket with mounting holes");
    const byName = Object.fromEntries(context.examples.map((item) => [item.name, item]));

    // "wall bracket" names the part; "reinforced" only describes it.
    expect(byName.l_bracket_ribs.score).toBeGreaterThan(byName.ribbed_mount.score);
    expect(byName.l_bracket_ribs.relevance).toBe(1);
    expect(byName.ribbed_mount.relevance).toBeLessThan(1);
    expect(byName.ribbed_mount.relevance).toBeGreaterThan(0);
    expect(byName.l_bracket_ribs.matchedAliases).toContain("wall bracket");
  });

  test("cuts each group to the retrieval budget", async () => {
    const context = await retrieveContext(
      "做一个可3d打印的电子外壳，带安装孔、加强筋和上下盖",
    );
    expect(context.examples.length).toBeLessThanOrEqual(RETRIEVAL_BUDGET.maxExamples);
    expect(context.patterns.length).toBeLessThanOrEqual(RETRIEVAL_BUDGET.maxPatterns);
    // This request matches more than the pattern budget, so the cap is doing work.
    expect(context.patterns.length).toBe(RETRIEVAL_BUDGET.maxPatterns);
  });

  test("returns the same order for the same request", async () => {
    const first = await retrieveContext("install a pipe clamp on a 20mm tube");
    const second = await retrieveContext("install a pipe clamp on a 20mm tube");
    expect(first.examples.map((item) => item.name)).toEqual(
      second.examples.map((item) => item.name),
    );
    expect(first.patterns.map((item) => item.name)).toEqual(
      second.patterns.map((item) => item.name),
    );
  });
});
