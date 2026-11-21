import { describe, expect, test } from "bun:test";
import { diffEvidence, diffRejudgeReport, extractRecordedCandidates, extractRejudgedCandidates, formatRejudgeDiff } from "./rejudge-diff";

describe("rejudge evidence diff", () => {
  test("reports added, removed and changed evidence ids", () => {
    const diff = diffEvidence(
      [
        { id: "compile", status: "PASS" },
        { id: "axial-retention", status: "NOT_RUN" },
        { id: "old-check", status: "FAIL" },
      ],
      [
        { id: "compile", status: "PASS" },
        { id: "axial-retention", status: "PASS" },
        { id: "measured-joint-frames", status: "PASS" },
      ],
    );
    expect(diff.added.map((row) => row.id)).toEqual(["measured-joint-frames"]);
    expect(diff.removed.map((row) => row.id)).toEqual(["old-check"]);
    expect(diff.changed).toEqual([{ id: "axial-retention", before: "NOT_RUN", after: "PASS", kind: "changed" }]);
  });

  test("joins recorded and rejudged candidates by task id and attempt", () => {
    const recorded = extractRecordedCandidates({
      allJudgements: [
        { taskId: "hinge", attempt: 0, evidence: [{ id: "compile", status: "PASS" }, { id: "axial-retention", status: "NOT_RUN" }, { id: "intent-preserved", status: "NOT_RUN" }] },
      ],
    });
    const rejudged = extractRejudgedCandidates({
      results: [
        { taskId: "hinge", attempt: 0, judgment: { evidence: [
          { id: "compile", status: "PASS" }, { id: "axial-retention", status: "PASS" },
          { id: "measured-joint-frames", status: "PASS" }, { id: "part-connectivity", status: "PASS" },
          { id: "intent-preserved", status: "NOT_RUN" },
        ] } },
      ],
    });
    const diff = diffRejudgeReport(recorded, rejudged);
    expect(diff.totals).toEqual({ added: 2, removed: 0, changed: 1, candidates: 1 });
    const [candidate] = diff.candidates;
    expect(candidate.taskId).toBe("hinge");
    // The layer view applies the current bench layer model to both sides.
    expect(candidate.beforeLayers.coverage).toEqual({ passed: 1, observed: 2, ratio: 0.5 });
    expect(candidate.afterLayers.coverage).toEqual({ passed: 4, observed: 4, ratio: 1 });
    expect(diff.scope).toContain("not candidate improvement");
  });

  test("a candidate that exists only after the rejudge is reported as all-added, not invented before", () => {
    const diff = diffRejudgeReport([], extractRejudgedCandidates({
      results: [{ taskId: "hinge", attempt: 3, judgment: { evidence: [{ id: "compile", status: "PASS" }, { id: "intent-preserved", status: "NOT_RUN" }] } }],
    }));
    const [candidate] = diff.candidates;
    expect(candidate.beforeLayers.coverage.observed).toBe(0);
    expect(candidate.added.map((row) => row.id)).toEqual(["compile", "intent-preserved"]);
  });

  test("malformed evidence rows are ignored instead of scored", () => {
    const candidates = extractRecordedCandidates({ allJudgements: [{ taskId: "hinge", attempt: 1.5, evidence: [] }, { taskId: "hinge", attempt: 2, evidence: [{ id: 1, status: "PASS" }, { id: "compile", status: "PASS" }] }] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence).toEqual([{ id: "compile", status: "PASS" }]);
  });

  test("formats the diff with the scope sentence", () => {
    const diff = diffRejudgeReport(extractRecordedCandidates({ allJudgements: [{ taskId: "hinge", attempt: 0, evidence: [{ id: "compile", status: "PASS" }] }] }),
      extractRejudgedCandidates({ results: [{ taskId: "hinge", attempt: 0, judgment: { evidence: [{ id: "compile", status: "PASS" }, { id: "source-motion", status: "PASS" }] } }] }));
    const text = formatRejudgeDiff(diff);
    expect(text).toContain("+ source-motion (PASS)");
    expect(text).toContain("1 candidate(s): 1 evidence id(s) added");
    expect(text).toContain("This measures verifier coverage, not candidate improvement");
  });
});
