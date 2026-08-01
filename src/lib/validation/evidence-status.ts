export type ValidationEvidenceStatus = "PASS" | "WARN" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";

export interface ValidationEvidenceLike {
  status?: string;
  passed: boolean;
  message: string;
}

const VALID_STATUSES = new Set<ValidationEvidenceStatus>([
  "PASS",
  "WARN",
  "FAIL",
  "SKIP",
  "ERROR",
  "NOT_RUN",
]);

/** Preserve legacy payloads while preferring explicit evidence status. */
export function getValidationEvidenceStatus(
  result: ValidationEvidenceLike,
): ValidationEvidenceStatus {
  const explicit = result.status?.toUpperCase() as ValidationEvidenceStatus | undefined;
  if (explicit && VALID_STATUSES.has(explicit)) return explicit;
  if (/^skipped\b/i.test(result.message.trim())) return "SKIP";
  return result.passed ? "PASS" : "FAIL";
}

export function isValidationActionable(result: ValidationEvidenceLike): boolean {
  return ["PASS", "WARN", "FAIL"].includes(getValidationEvidenceStatus(result));
}

export function isValidationUnresolved(result: ValidationEvidenceLike): boolean {
  return ["SKIP", "ERROR", "NOT_RUN"].includes(getValidationEvidenceStatus(result));
}
