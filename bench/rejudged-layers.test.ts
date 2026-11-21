import { describe, expect, test } from "bun:test";
import { formatRejudgedLayers, summarizeRejudgedLayers } from "./rejudged-layers";

describe("rejudged layer summary", () => {
  test("aggregates the same layer model the benchmark uses", () => {
    const summary = summarizeRejudgedLayers([
      {
        taskId: "hinge", attempt: 0,
        evidence: [
          { id: "compile", status: "PASS" },
          { id: "distinct-exported-parts", status: "PASS" },
          { id: "source-motion", status: "PASS" },
          { id: "axial-retention", status: "FAIL" },
          { id: "intent-preserved", status: "NOT_RUN" },
        ],
      },
      {
        taskId: "hinge", attempt: 1,
        evidence: [
          { id: "compile", status: "PASS" },
          { id: "source-motion", status: "NOT_RUN" },
          { id: "axial-retention", status: "PASS" },
        ],
      },
    ]);
    expect(summary.candidates).toBe(2);
    expect(summary.evidenceEntries).toBe(8);
    const byLayer = new Map(summary.layers.map((row) => [row.layer, row]));
    // compile is observed twice with PASS/PASS.
    expect(byLayer.get("compile")).toMatchObject({ observed: 2, passed: 2, failed: 0, worst: "PASS" });
    // retention is observed twice; FAIL wins over PASS in the worst-status view.
    expect(byLayer.get("retention")).toMatchObject({ observed: 2, passed: 1, failed: 1, worst: "FAIL" });
    // source-motion is observed twice; NOT_RUN is not a pass.
    expect(byLayer.get("source-motion")).toMatchObject({ observed: 2, passed: 1, notRun: 1, worst: "NOT_RUN" });
    // A layer with no evidence stays unobserved and out of the denominator.
    expect(byLayer.get("reconstruction")).toMatchObject({ observed: 0, worst: null });
    // Summed across candidates: candidate 0 covers 4 layers and passes 3, candidate 1 covers 3 and passes 2.
    expect(summary.coverage).toEqual({ passed: 5, observed: 7, ratio: 5 / 7 });
    // intent-preserved is deliberately unmapped; it is reported, never scored.
    expect(summary.unmappedEvidence).toContain("intent-preserved");
    expect(summary.scope).toContain("not a new model trial");
  });

  test("gate pass counts only candidates whose evidence produced a verdict", () => {
    const summary = summarizeRejudgedLayers([
      { taskId: "a", attempt: 0, evidence: [{ id: "compile", status: "PASS" }, { id: "intent-preserved", status: "NOT_RUN" }] },
      { taskId: "a", attempt: 1, evidence: [{ id: "compile", status: "FAIL" }] },
    ]);
    // intent-preserved is excluded from the delivery gate; candidate 0 passes,
    // candidate 1 fails.
    expect(summary.gatePassed).toBe(1);
    expect(summary.coverage).toEqual({ passed: 1, observed: 2, ratio: 0.5 });
  });

  test("formats a bounded table with the coverage line", () => {
    const summary = summarizeRejudgedLayers([
      { taskId: "a", attempt: 0, evidence: [{ id: "compile", status: "PASS" }] },
    ]);
    const text = formatRejudgedLayers(summary);
    expect(text).toContain("layer");
    expect(text).toContain("1 candidate(s), 1 evidence entries");
    expect(text).toContain("coverage 1/1 (100.0%)");
  });
});
