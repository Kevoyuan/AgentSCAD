import { describe, expect, test } from "bun:test";

import { aggregateLayers, deliveryGate, diagnose, LAYER_IDS, LAYERS, scoreEvidence, worstStatus } from "./layers";

describe("layer model", () => {
  test("every evidence id feeds exactly one layer", () => {
    const seen = new Set<string>();
    for (const layer of LAYERS) {
      for (const id of layer.evidence) {
        // Two layers claiming one fact would let a single pass raise coverage twice.
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(LAYERS.map((layer) => layer.id)).toEqual([...LAYER_IDS]);
  });

  test("NOT_RUN never counts as coverage", () => {
    const scored = scoreEvidence([
      { id: "distinct-exported-parts", status: "PASS" },
      { id: "part-connectivity", status: "NOT_RUN" },
    ]);
    expect(scored.coverage.passed).toBe(1);
    expect(scored.coverage.observed).toBe(2);
    expect(scored.coverage.ratio).toBe(0.5);
    expect(scored.coverage.unobserved).toContain("rigid-motion");
  });

  test("an unobserved layer leaves the denominator instead of passing", () => {
    const scored = scoreEvidence([{ id: "distinct-exported-parts", status: "PASS" }]);
    expect(scored.coverage.observed).toBe(1);
    expect(scored.coverage.ratio).toBe(1);
    // Perfect score, but only one layer was ever looked at. That distinction is
    // the whole reason `unobserved` is reported alongside the ratio.
    expect(scored.coverage.unobserved.length).toBe(LAYER_IDS.length - 1);
    expect(scored.gate.passed).toBe(true);
  });

  test("worst status wins inside a layer", () => {
    expect(worstStatus(["PASS", "SKIP"])).toBe("SKIP");
    expect(worstStatus(["PASS", "NOT_RUN"])).toBe("NOT_RUN");
    expect(worstStatus(["NOT_RUN", "FAIL"])).toBe("FAIL");
    expect(worstStatus(["FAIL", "ERROR"])).toBe("ERROR");
  });

  test("a passing sibling cannot rescue a failing item in the same layer", () => {
    // `sampled-motion` PASS next to `motion-range-deg` FAIL is not a pass.
    const scored = scoreEvidence([
      { id: "sampled-motion", status: "PASS" },
      { id: "motion-range-deg", status: "FAIL" },
    ]);
    const rigid = scored.layers.find((layer) => layer.layer === "rigid-motion");
    expect(rigid?.status).toBe("FAIL");
    expect(scored.coverage.ratio).toBe(0);
    expect(scored.gate.passed).toBe(false);
  });

  test("the gate excludes intent-preserved, which has no independent audit", () => {
    // The product states it cannot audit intent, so scoring it here would
    // invent an audit. It must not block the gate either.
    const scored = scoreEvidence([
      { id: "distinct-exported-parts", status: "PASS" },
      { id: "intent-preserved", status: "NOT_RUN" },
    ]);
    expect(scored.gate.passed).toBe(true);
    expect(scored.unmappedEvidence).toContain("intent-preserved");
  });

  test("the gate is all-or-nothing over non-intent evidence", () => {
    expect(deliveryGate([])).toEqual({ passed: null, reason: expect.any(String) });
    expect(deliveryGate([{ id: "compile", status: "PASS" }]).passed).toBe(true);
    expect(deliveryGate([{ id: "compile", status: "PASS" }, { id: "sampled-motion", status: "NOT_RUN" }]).passed).toBe(false);
    expect(deliveryGate([{ id: "compile", status: "ERROR" }]).passed).toBe(false);
  });

  test("duplicate and unknown evidence are surfaced, never silently dropped", () => {
    const scored = scoreEvidence([
      { id: "distinct-exported-parts", status: "PASS" },
      { id: "distinct-exported-parts", status: "FAIL" },
      { id: "part-connectivity", status: "MEASURED" },
    ]);
    expect(scored.unmappedEvidence).toContain("distinct-exported-parts:duplicate");
    expect(scored.unmappedEvidence).toContain("part-connectivity:MEASURED");
    expect(scored.layers.find((layer) => layer.layer === "parts-identity")?.status).toBe("PASS");
  });

  test("nothing observed yields a null ratio, not a zero", () => {
    const scored = scoreEvidence([]);
    expect(scored.coverage.ratio).toBeNull();
    expect(scored.coverage.observed).toBe(0);
    expect(scored.gate.passed).toBeNull();
  });
});

describe("layer diagnosis", () => {
  test("NOT_RUN dominance is a missing check, not a missing capability", () => {
    expect(diagnose({ pass: 0, fail: 0, error: 0, notRun: 23, skip: 0 })).toBe("measurement-gap");
  });

  test("ERROR dominance is left undetermined because the status does not say why", () => {
    // The same ERROR can be "no bore was drawn" or "the budget ran out".
    expect(diagnose({ pass: 8, fail: 0, error: 20, notRun: 0, skip: 0 })).toBe("undetermined");
  });

  test("a decided failure is a capability gap", () => {
    expect(diagnose({ pass: 3, fail: 19, error: 1, notRun: 3, skip: 0 })).toBe("capability-gap");
  });

  test("a mostly-passing layer is healthy even with some failures", () => {
    expect(diagnose({ pass: 26, fail: 3, error: 0, notRun: 1, skip: 0 })).toBe("healthy");
  });

  test("aggregate counts absent layers separately from NOT_RUN", () => {
    const aggregate = aggregateLayers([
      scoreEvidence([{ id: "distinct-exported-parts", status: "PASS" }]),
      scoreEvidence([{ id: "distinct-exported-parts", status: "NOT_RUN" }]),
    ]);
    const identity = aggregate.find((row) => row.layer === "parts-identity");
    expect(identity?.pass).toBe(1);
    expect(identity?.notRun).toBe(1);
    const motion = aggregate.find((row) => row.layer === "rigid-motion");
    expect(motion?.absent).toBe(2);
    expect(motion?.diagnosis).toBe("unobserved");
  });
});
