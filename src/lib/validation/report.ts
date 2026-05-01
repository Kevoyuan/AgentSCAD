import type { ValidationCheck, ValidationReport } from "./validation-types";

export function computeReport(checks: ValidationCheck[]): ValidationReport {
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  const skipped = checks.filter((c) => c.message.toLowerCase().startsWith("skipped")).length;
  const critical_failures = checks.filter((c) => !c.passed && c.is_critical).length;

  const actionable = checks.filter((c) => !c.message.toLowerCase().startsWith("skipped"));
  const actionableScore = actionable.length > 0
    ? actionable.filter((c) => c.passed).length / actionable.length
    : 1;

  return {
    ok: critical_failures === 0,
    score: Math.round(actionableScore * 100) / 100,
    checks,
    summary: { total: checks.length, passed, failed, skipped, critical_failures },
  };
}
