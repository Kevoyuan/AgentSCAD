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

/** Validate untrusted tool output before admitting it into the evidence model. */
export function parseValidationEvidenceStatus(value: unknown): ValidationEvidenceStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toUpperCase() as ValidationEvidenceStatus;
  return VALID_STATUSES.has(normalized) ? normalized : undefined;
}

/** Preserve legacy payloads while preferring explicit evidence status. */
export function getValidationEvidenceStatus(
  result: ValidationEvidenceLike,
): ValidationEvidenceStatus {
  if (result.status !== undefined) return parseValidationEvidenceStatus(result.status) ?? "ERROR";
  if (/^skipped\b/i.test(result.message.trim())) return "SKIP";
  return result.passed ? "PASS" : "FAIL";
}

export function isValidationActionable(result: ValidationEvidenceLike): boolean {
  return ["PASS", "WARN", "FAIL"].includes(getValidationEvidenceStatus(result));
}

export function isValidationUnresolved(result: ValidationEvidenceLike): boolean {
  return ["SKIP", "ERROR", "NOT_RUN"].includes(getValidationEvidenceStatus(result));
}
