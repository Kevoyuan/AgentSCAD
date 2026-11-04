import { expect, test } from "bun:test";
import { measurementExitCode, requiredMeasurementStatus } from "./measurement-status";

test("incomplete required measurements cannot report success", () => {
  for (const checks of [[], ["PASS", "NOT_RUN"], ["NOT_RUN"]] as const) {
    expect(requiredMeasurementStatus(checks)).toBe("NOT_RUN");
    expect(measurementExitCode(requiredMeasurementStatus(checks))).toBe(2);
  }
  expect(requiredMeasurementStatus(["PASS", "PASS"])).toBe("PASS");
  expect(measurementExitCode("PASS")).toBe(0);
  expect(requiredMeasurementStatus(["FAIL", "NOT_RUN", "ERROR"])).toBe("FAIL");
  expect(measurementExitCode("FAIL")).toBe(1);
  expect(requiredMeasurementStatus(["PASS", "ERROR"])).toBe("ERROR");
  expect(measurementExitCode("ERROR")).toBe(2);
});
