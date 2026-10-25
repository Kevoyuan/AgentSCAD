import { describe, expect, test } from "bun:test";

import { getValidationEvidenceStatus, parseValidationEvidenceStatus } from "@/lib/validation/evidence-status";
import { getValidationEvidenceStatus as clientEvidenceStatus } from "@/components/cad/types";
import { checkHoleTargets, checkHoleCount, inferExpectedMinimumHoleCount } from "@/lib/validation/hole-check";
import { computeReport } from "@/lib/validation/report";

describe("validation evidence status", () => {
  test("shares one parser across server and client, rejecting unknown tool statuses", () => {
    expect(clientEvidenceStatus).toBe(getValidationEvidenceStatus);
    expect(parseValidationEvidenceStatus("warn")).toBe("WARN");
    for (const value of ["success", "", null, 42, {}]) {
      expect(parseValidationEvidenceStatus(value)).toBeUndefined();
    }
    expect(getValidationEvidenceStatus({ status: "success", passed: true, message: "ok" })).toBe("ERROR");
    expect(getValidationEvidenceStatus({ passed: true, message: "legacy" })).toBe("PASS");
  });
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


describe("hole acceptance regressions", () => {
  test("parses Chinese counts and rejects an actual one-hole part", () => {
    for (const check of ["4个通孔", "四个安装孔", "十二个通孔", "12个通孔"]) {
      const expected = inferExpectedMinimumHoleCount([check]);
      expect(expected).toBe(check.includes("十二") || check.includes("12") ? 12 : 4);
      expect(checkHoleCount({ isWatertight: true, genus: 1 } as any, expected).status).toBe("FAIL");
    }
  });
  test("does not turn absent, blind, or unspecified holes into required through holes", () => {
    expect(inferExpectedMinimumHoleCount(["no holes"])).toBe(0);
    for (const check of ["无孔", "0个通孔", "零个通孔", "0 holes"]) {
      expect(inferExpectedMinimumHoleCount([check])).toBe(0);
    }
    expect(inferExpectedMinimumHoleCount(["four blind holes"])).toBeUndefined();
    expect(inferExpectedMinimumHoleCount(["四个盲孔"])).toBeUndefined();
    expect(inferExpectedMinimumHoleCount(["holes are unobstructed"])).toBeUndefined();
  });
  test("does not add repeated descriptions of the same hole group", () => {
    expect(inferExpectedMinimumHoleCount(["four through holes", "all four holes unobstructed"])).toBe(4);
    expect(inferExpectedMinimumHoleCount(["4 mounting holes", "four mounting holes unobstructed", "one central hole"])).toBe(5);
  });
  test("enforces exact zero and rejects malformed count contracts", () => {
    const data = { isWatertight: true, genus: 1 } as any;
    expect(checkHoleCount(data, 0, 0).status).toBe("FAIL");
    expect(checkHoleCount(data, 4, 4).status).toBe("FAIL");
    expect(checkHoleCount(data, -1).status).toBe("ERROR");
    expect(checkHoleCount(data, "4" as any).status).toBe("ERROR");
  });
});


test("structured hole targets override prose and validate untrusted numbers", () => {
  const data = { isWatertight: true, genus: 1 } as any;
  const target = { expected_bbox: [], required_feature_checks: ["one hole"], forbidden_failure_modes: [] };
  expect(checkHoleTargets(data, { ...target, expected_through_holes: 4 }).status).toBe("FAIL");
  expect(checkHoleTargets(data, { ...target, expected_through_holes: 1 }).status).toBe("PASS");
  expect(checkHoleTargets(data, { ...target, expected_through_holes: 0 }).status).toBe("FAIL");
  expect(checkHoleTargets({ ...data, genus: 0 }, { ...target, expected_through_holes: 0 }).status).toBe("PASS");
  expect(checkHoleTargets({ ...data, genus: 5 }, { ...target, expected_through_holes: 4 }).status).toBe("FAIL");
  for (const invalid of [null, "4", 1.5, -1, Infinity]) {
    expect(checkHoleTargets(data, { ...target, expected_through_holes: invalid as any }).status).toBe("ERROR");
  }
  expect(inferExpectedMinimumHoleCount(["四个盲孔和两个通孔"])).toBe(2);
});
