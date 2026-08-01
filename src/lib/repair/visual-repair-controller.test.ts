import { describe, expect, test } from "bun:test";

import {
  normalizeVisualRepairReport,
  resolvePostRepairOutcome,
  visualRepairReportToValidationResult,
} from "./visual-repair-controller";
import { hasImageInput } from "@/lib/tools/model-router";

describe("visual repair evidence", () => {
  test("rejects malformed or non-actionable failed evaluations", () => {
    expect(() => normalizeVisualRepairReport("not json")).toThrow();
    expect(() => normalizeVisualRepairReport(JSON.stringify({
      passed: false,
      confidence: 0.2,
      issues: [],
      missing_features: [],
    }))).toThrow("without an actionable visual issue");
  });

  test("normalizes the blind visual-validation contract into repair issues", () => {
    const report = normalizeVisualRepairReport(JSON.stringify({
      passed: false,
      confidence: 0.35,
      summary: "mounting hole missing",
      issues: [{ severity: "critical", feature: "mounting hole", message: "not visible" }],
      missing_features: [],
    }));

    expect(report.visual_issues[0]).toMatchObject({
      requirement: "mounting hole",
      observed: "not visible",
      severity: "high",
    });
    expect(visualRepairReportToValidationResult(report)).toMatchObject({
      status: "FAIL",
      passed: false,
      is_critical: true,
    });
  });

  test("keeps low-confidence issue-free evaluation as a warning", () => {
    const result = visualRepairReportToValidationResult({
      visual_issues: [],
      overall_visual_match: 0.6,
      repair_summary: "rear face is not visible",
    });
    expect(result).toMatchObject({ status: "WARN", passed: true, is_critical: false });
  });

  test("delivers PASS/WARN outcomes and routes FAIL/ERROR outcomes to review", () => {
    expect(resolvePostRepairOutcome([], "PASS")).toMatchObject({ nextState: "DELIVERED", repaired: true });
    expect(resolvePostRepairOutcome([], "WARN")).toMatchObject({ nextState: "DELIVERED", repaired: true });
    expect(resolvePostRepairOutcome(["V001"], "FAIL")).toEqual({
      nextState: "HUMAN_REVIEW",
      repaired: false,
      reviewReasons: ["V001"],
    });
    expect(resolvePostRepairOutcome([], "ERROR")).toEqual({
      nextState: "HUMAN_REVIEW",
      repaired: false,
      reviewReasons: ["V001_ERROR"],
    });
  });

  test("marks multimodal requests so they cannot fall back to a text-only model", () => {
    expect(hasImageInput([{ role: "user", content: [
      { type: "text", text: "inspect" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ] }])).toBe(true);
    expect(hasImageInput([{ role: "user", content: "text only" }])).toBe(false);
  });
});
