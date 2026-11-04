import { describe, expect, test } from "bun:test";
import { evaluateAssembly, type Observation, type Requirement } from "./assembly-evidence";

const required: Requirement = { id: "clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "range", min: 0.1, max: 0.3, unit: "mm" } };
const measured = (value: number, uncertainty = 0.01): Observation => ({ id: "clearance", status: "MEASURED", value, uncertainty, unit: "mm", artifactSha256: "a".repeat(64), method: "independent gauge", toolVersion: "1", coverage: "specified cross-section" });

describe("independent assembly evidence comparisons", () => {
  test("missing measurements remain NOT_RUN and block the gate", () => {
    const report = evaluateAssembly([required], []);
    expect(report.evidence[0].status).toBe("NOT_RUN");
    expect(report.gate_passed).toBe(false);
  });
  test("compares a measurement interval against frozen clearance bounds", () => {
    expect(evaluateAssembly([required], [measured(0.2)]).evidence[0].status).toBe("PASS");
    expect(evaluateAssembly([required], [measured(0.05)]).evidence[0].status).toBe("FAIL");
    expect(evaluateAssembly([required], [measured(0.1)]).evidence[0].status).toBe("ERROR");
  });
  test("unavailable, inapplicable and malformed provenance never pass", () => {
    expect(evaluateAssembly([required], [{ id: "clearance", status: "ERROR" }]).evidence[0].status).toBe("ERROR");
    expect(evaluateAssembly([{ ...required, applicable: false }], []).evidence[0].status).toBe("SKIP");
    expect(evaluateAssembly([required], [{ ...measured(0.2), artifactSha256: "bad" }]).evidence[0].status).toBe("ERROR");
    expect(evaluateAssembly([required], [{ ...measured(0.2), unit: "inch" }]).evidence[0].status).toBe("ERROR");
    expect(evaluateAssembly([required], [{ ...measured(0.2), method: 123 } as unknown as Observation]).evidence[0].status).toBe("ERROR");
    expect(evaluateAssembly([required], [{ ...measured(0.2), uncertainty: -0.01 }]).evidence[0].status).toBe("ERROR");
  });
  test("injected failures remain visible even beside errors and missing evidence", () => {
    const checks: Requirement[] = [required, { id: "motion", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } }, { id: "physical", layer: "physical", required: true, applicable: true, expected: { kind: "equals", value: true } }];
    const report = evaluateAssembly(checks, [measured(0.02), { id: "motion", status: "ERROR" }]);
    expect(report.evidence.map((item) => item.status)).toEqual(["FAIL", "ERROR", "NOT_RUN"]);
    expect(report.gate_passed).toBe(false);
  });
  test("duplicate or unrequested observations are rejected", () => {
    expect(() => evaluateAssembly([required], [measured(0.2), measured(0.2)])).toThrow();
    expect(() => evaluateAssembly([required], [{ ...measured(0.2), id: "unknown" }])).toThrow();
  });
  test("invalid frozen values cannot match absent measurements", () => {
    const invalid = { id: "bad", layer: "parts", required: true, applicable: true, expected: { kind: "equals" } } as unknown as Requirement;
    const report = evaluateAssembly([invalid], [{ ...measured(0.2), id: "bad", value: undefined }]);
    expect(report.evidence[0].status).toBe("ERROR");
    expect(report.gate_passed).toBe(false);
  });

  describe("lower bounds", () => {
    const reach: Requirement = { id: "reach", layer: "motion", required: true, applicable: true, expected: { kind: "atLeast", min: 45, unit: "deg" } };
    const swept = (value: number, uncertainty = 0): Observation => ({ id: "reach", status: "MEASURED", value, uncertainty, unit: "deg", artifactSha256: "b".repeat(64), method: "sampled poses", toolVersion: "1", coverage: "declared range" });

    test("reaching the minimum passes and stopping short fails", () => {
      expect(evaluateAssembly([reach], [swept(45)]).evidence[0].status).toBe("PASS");
      expect(evaluateAssembly([reach], [swept(60)]).evidence[0].status).toBe("PASS");
      expect(evaluateAssembly([reach], [swept(30)]).evidence[0].status).toBe("FAIL");
    });

    test("uncertainty cannot buy a pass at the boundary", () => {
      // 45 ± 2 could be 43, so it is not proven to reach 45.
      expect(evaluateAssembly([reach], [swept(45, 2)]).evidence[0].status).toBe("ERROR");
      expect(evaluateAssembly([reach], [swept(47, 2)]).evidence[0].status).toBe("PASS");
      expect(evaluateAssembly([reach], [swept(42, 2)]).evidence[0].status).toBe("FAIL");
    });

    test("a lower bound needs a matching unit and a measured value", () => {
      expect(evaluateAssembly([reach], [{ ...swept(45), unit: "mm" }]).evidence[0].status).toBe("ERROR");
      expect(evaluateAssembly([reach], [{ id: "reach", status: "NOT_RUN" }]).evidence[0].status).toBe("NOT_RUN");
    });
  });
});
