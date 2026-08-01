import { describe, expect, test } from "bun:test";

import { getValidationEvidenceStatus } from "@/lib/validation/evidence-status";
import { inferExpectedMinimumHoleCount } from "@/lib/validation/hole-check";
import { computeReport } from "@/lib/validation/report";

describe("validation evidence status", () => {
  test("keeps legacy skipped results out of passed counts", () => {
    const skipped = {
      rule_id: "S001",
      rule_name: "Semantic",
      level: "SEMANTIC" as const,
      passed: true,
      is_critical: true,
      message: "Skipped — not run",
    };
    expect(getValidationEvidenceStatus(skipped)).toBe("SKIP");
    const report = computeReport([skipped]);
    expect(report.summary).toMatchObject({ passed: 0, skipped: 1, failed: 0 });
    expect(report.score).toBe(0);
    expect(report.evidence_complete).toBe(false);
  });

  test("weights explicit warnings without converting them to passes", () => {
    const report = computeReport([
      { rule_id: "R001", rule_name: "Wall", level: "ENGINEERING", passed: true, status: "PASS", is_critical: true, message: "ok" },
      { rule_id: "R002", rule_name: "Size", level: "MANUFACTURING", passed: true, status: "WARN", is_critical: false, message: "close to limit" },
    ]);
    expect(report.summary).toMatchObject({ passed: 1, warnings: 1, failed: 0 });
    expect(report.score).toBe(0.75);
  });

  test("keeps ok false when a critical check errors", () => {
    const report = computeReport([
      { rule_id: "V001", rule_name: "Visual", level: "SEMANTIC", passed: false, status: "ERROR", is_critical: true, message: "unavailable" },
    ]);
    expect(report.ok).toBe(false);
    expect(report.evidence_complete).toBe(false);
    expect(report.summary).toMatchObject({ errors: 1, critical_failures: 0 });
  });
});

describe("hole expectation parsing", () => {
  test("extracts actual requested counts instead of counting sentences", () => {
    expect(inferExpectedMinimumHoleCount(["four through holes"])).toBe(4);
    expect(inferExpectedMinimumHoleCount(["4 mounting holes", "one central hole"])).toBe(5);
    expect(inferExpectedMinimumHoleCount(["两个通孔"])).toBe(2);
    expect(inferExpectedMinimumHoleCount(["single connected body"])).toBeUndefined();
  });
});
