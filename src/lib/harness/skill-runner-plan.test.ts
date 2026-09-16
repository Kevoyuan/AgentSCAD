import { describe, expect, test } from "bun:test";

import { applyGenerationPlan } from "./skill-runner";
import { normalizeGenerationResult } from "./structured-output";
import type { CadGenerationPlan, StructuredGenerationResult } from "./types";

describe("SCAD coding plan contract", () => {
  test("preserves generated artifact fields while applying approved plan metadata", () => {
    const fallbackParameters = [{ key: "width", label: "Width", kind: "float", unit: "mm", value: 42, min: 1, max: 100, step: 1, source: "artifact", editable: true, description: "Width", group: "geometry" }];
    const generated = normalizeGenerationResult(
      "```scad\nwidth = 42;\nmodule generated_part() { cube([width, 10, 10]); }\ngenerated_part();\n```",
      fallbackParameters,
      "fallback",
    ) satisfies StructuredGenerationResult;
    const plan = {
      ...generated,
      part_type: "phone_case",
      summary: "approved phone case",
      parameters: undefined,
      scad_source: undefined,
    } as unknown as CadGenerationPlan;

    const result = applyGenerationPlan(generated, plan);

    expect(result.part_type).toBe("phone_case");
    expect(result.summary).toBe("approved phone case");
    expect(result.parameters).toEqual(generated.parameters);
    expect(result.scad_source).toBe(generated.scad_source);
  });
});
