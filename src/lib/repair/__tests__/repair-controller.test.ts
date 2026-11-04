import { describe, expect, test } from "bun:test";
import { assertRepairCompletionUsable, buildRepairPrompt } from "@/lib/repair/repair-controller";
import type { ModelCompletionResponse } from "@/lib/tools/model-router";

function completion(overrides: Partial<ModelCompletionResponse> = {}): ModelCompletionResponse {
  return {
    content: "// repaired\nbody_length = 158;\ngenerated_part();\n",
    model: "deepseek-flash",
    provider: "DeepSeek",
    finishReason: "stop",
    responseLength: 0,
    rawSnippet: "",
    ...overrides,
  };
}

test("repair prompt separates failed geometry from unavailable evidence and retains constraints", () => {
  const prompt = buildRepairPrompt({
    originalRequest: "two-part hinge",
    partFamily: "unknown",
    currentScadCode: "generated_part();",
    cadIntent: { constraints: { explicit_constraints: ["two separate moving parts"] } },
    validationResults: [
      { rule_id: "C001", rule_name: "Compile", level: "ENGINEERING", passed: false, is_critical: true, message: "syntax error", status: "FAIL" },
      { rule_id: "R001", rule_name: "Wall", level: "ENGINEERING", passed: false, is_critical: true, message: "Skipped: validator unavailable", status: "SKIP" },
      { rule_id: "C002", rule_name: "Components", level: "ENGINEERING", passed: false, is_critical: true, message: "tool error", status: "ERROR" },
    ],
  });
  const failed = prompt.split("### Failed Rules")[1].split("### Passing and Warning Rules")[0];
  expect(failed).toContain("C001 Compile");
  expect(failed).not.toContain("R001 Wall");
  expect(failed).not.toContain("C002 Components");
  expect(prompt).toContain("SKIP R001 Wall");
  expect(prompt).toContain("ERROR C002 Components");
  expect(prompt).toContain("two separate moving parts");
});

describe("repair completion guard", () => {
  test("accepts a complete repair reply", () => {
    expect(() => assertRepairCompletionUsable(completion())).not.toThrow();
  });

  test("rejects a repair reply cut off mid-file by the output budget", () => {
    // Regression: a truncated reply (source ending mid-assignment) used to be
    // persisted as valid SCAD and only failed later inside the OpenSCAD renderer.
    expect(() =>
      assertRepairCompletionUsable(
        completion({
          content: "// iPhone 18 Duo\nbody_length = 158;\nbutton_chamfer",
          finishReason: "length",
          responseLength: 1325,
        })
      )
    ).toThrow("cut off before it finished");
  });

  test("rejects an empty reply and reports the truncation code", () => {
    try {
      assertRepairCompletionUsable(
        completion({ content: "", finishReason: "length", responseLength: 0 })
      );
      throw new Error("expected the guard to throw");
    } catch (error) {
      const failure = error as { code?: string; evidence?: { responseLength?: number } };
      expect(failure.code).toBe("LLM_OUTPUT_TRUNCATED");
      expect(failure.evidence?.responseLength).toBe(0);
    }
  });

  test("rejects an empty reply without a length finish reason", () => {
    expect(() =>
      assertRepairCompletionUsable(completion({ content: "   ", finishReason: "stop" }))
    ).toThrow("returned no content");
  });
});

 test("complexity repair reduces boolean geometry while preserving functional constraints", () => {
  const prompt = buildRepairPrompt({
    originalRequest: "V8 assembly", partFamily: "unknown", currentScadCode: "cube(10);",
    repairStrategy: "simplify", validationResults: [],
  });
  expect(prompt).toContain("Reduce repeated hull()/minkowski()");
  expect(prompt).toContain("functional features, fitting surfaces");
  expect(prompt).toContain("syntax and geometry are not yet verified");
  expect(prompt).toContain("Never merge, omit, or replace any explicitly required parts");
 });

describe("measured assembly failures in the repair prompt", () => {
  const finding = {
    kind: "motion" as const, layer: "motion" as const,
    connectionId: "hinge", instanceIds: ["leaf-b", "leaf-a"],
    measured: "blocked at 137.50°", required: "-180.00–180.00 deg",
    atMm: null, atDeg: 137.5,
    message: "Rotating through the declared range is blocked at 137.50°: leaf-b interferes with leaf-a.",
  };

  test("a measured failure is carried into the prompt with its numbers and the invariants", () => {
    const prompt = buildRepairPrompt({
      originalRequest: "a hinge that opens 180 degrees", partFamily: "unknown",
      currentScadCode: "generated_part();", validationResults: [],
      assemblyFindings: [finding],
    });
    const block = prompt.split("## Measured Assembly Failures")[1].split("## Repair Goal")[0];
    expect(block).toContain("blocked at 137.50°");
    expect(block).toContain("required: -180.00–180.00 deg");
    expect(block).toContain("instances: leaf-b, leaf-a");
    expect(block).toContain("connection: hinge");
    expect(block).toContain("measured on the rendered geometry");
    expect(block).toContain("Do not change the declared motion range to a smaller one.");
    expect(block).toContain("Do not change which instance carries the bore.");
  });

  test("without measured failures the prompt is unchanged", () => {
    const prompt = buildRepairPrompt({
      originalRequest: "a hinge", partFamily: "unknown", currentScadCode: "cube(1);", validationResults: [],
    });
    expect(prompt).not.toContain("## Measured Assembly Failures");
    expect(prompt).not.toContain("Do not change which instance carries the bore.");
    // The existing goal wording is still there, so the block is additive.
    expect(prompt).toContain("Fix ONLY the failed validation checks listed above.");
  });
});
