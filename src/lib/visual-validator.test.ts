import { describe, expect, test } from "bun:test";

import { buildVisualValidationResult } from "./visual-validator";

describe("visual validation evidence", () => {
  test("does not let a model pass while reporting missing visible features", () => {
    const result = buildVisualValidationResult({
      passed: true,
      confidence: 0.95,
      summary: "looks fine",
      issues: [],
      missing_features: ["camera opening"],
    }, "raw");

    expect(result).toMatchObject({ passed: false, status: "FAIL", is_critical: true });
    expect(result.message).toContain("camera opening");
  });

  test("reports uncertain visual judgment as WARN rather than PASS", () => {
    const result = buildVisualValidationResult({
      passed: true,
      confidence: 0.45,
      summary: "rear face is not visible",
      issues: [{ severity: "warning", feature: "rear port", message: "camera angle is insufficient" }],
      missing_features: [],
    }, "raw");

    expect(result).toMatchObject({ passed: true, status: "WARN", is_critical: false });
  });
});
