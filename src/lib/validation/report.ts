import type { ValidationCheck, ValidationReport } from "./validation-types";
import { getValidationEvidenceStatus } from "./evidence-status";

export function computeReport(checks: ValidationCheck[]): ValidationReport {
  const statusCounts = checks.reduce<Record<ReturnType<typeof getValidationEvidenceStatus>, number>>(
    (counts, item) => {
      const status = getValidationEvidenceStatus(item);
      counts[status] += 1;
      return counts;
    },
    { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0, ERROR: 0, NOT_RUN: 0 },
  );
  const critical_failures = checks.filter(
    (check) => getValidationEvidenceStatus(check) === "FAIL" && check.is_critical,
  ).length;
  const critical_errors = checks.filter(
    (check) => getValidationEvidenceStatus(check) === "ERROR" && check.is_critical,
  ).length;

  const actionable = checks.filter((check) =>
    ["PASS", "WARN", "FAIL"].includes(getValidationEvidenceStatus(check)),
  );
  const actionableScore = actionable.length > 0
    ? actionable.reduce((score, check) => {
        const status = getValidationEvidenceStatus(check);
        return score + (status === "PASS" ? 1 : status === "WARN" ? 0.5 : 0);
      }, 0) / actionable.length
    : 0;
  const evidence_complete = statusCounts.SKIP === 0 && statusCounts.ERROR === 0 && statusCounts.NOT_RUN === 0;

  return {
    ok: critical_failures === 0 && critical_errors === 0,
    score: Math.round(actionableScore * 100) / 100,
    checks,
    summary: {
      total: checks.length,
      passed: statusCounts.PASS,
      warnings: statusCounts.WARN,
      failed: statusCounts.FAIL,
      skipped: statusCounts.SKIP,
      errors: statusCounts.ERROR,
      not_run: statusCounts.NOT_RUN,
      critical_failures,
    },
    evidence_complete,
  };
}
