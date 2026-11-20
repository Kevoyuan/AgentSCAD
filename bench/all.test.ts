import { describe, expect, test } from "bun:test";
import { formatMatrix, summarizeReport } from "./all";

describe("bench matrix", () => {
  test("counts references, adversarial and layer coverage from cases", () => {
    const row = summarizeReport("demo", "bench/demo/report.json", 0, "SELF-CHECK OK: 1 reference(s) pass, 1 adversarial submission(s) rejected.", {
      cases: [
        { expected: "pass", status: "PASS", layers: { coverage: { passed: 4, observed: 4 } } },
        { expected: "fail", status: "FAIL", layers: { coverage: { passed: 1, observed: 4 } } },
      ],
    });
    expect(row.selfCheck).toBe(true);
    expect(row.references).toBe(1);
    expect(row.adversarial).toBe(1);
    expect(row.layers).toEqual({ passed: 5, observed: 8 });
    expect(formatMatrix([row])).toContain("demo");
  });

  test("marks a nonzero exit or missing self-check as failed", () => {
    const row = summarizeReport("demo", "bench/demo/report.json", 1, "boom", { reports: [] });
    expect(row.selfCheck).toBe(false);
    expect(row.cases).toBe(0);
  });
});
