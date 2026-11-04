export type MeasurementStatus = "PASS" | "FAIL" | "ERROR" | "NOT_RUN";

/** Required checks must all pass. Missing checks never become positive evidence. */
export function requiredMeasurementStatus(statuses: readonly MeasurementStatus[]): MeasurementStatus {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("ERROR")) return "ERROR";
  if (!statuses.length || statuses.includes("NOT_RUN")) return "NOT_RUN";
  return "PASS";
}

export function measurementExitCode(status: MeasurementStatus): number {
  return status === "PASS" ? 0 : status === "FAIL" ? 1 : 2;
}
