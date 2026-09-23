import { describe, expect, test } from "bun:test";

import { buildGenerationPlan, restoreGenerationPlan } from "./generation-plan";
import type { RequestIntelligenceV1 } from "@/lib/intake/request-intelligence";

const intelligence: RequestIntelligenceV1 = {
  version: 1,
  rawRequest: "phone case with camera and button holes",
  normalizedRequest: "phone case with camera and button holes",
  language: "en",
  status: "MATCHED",
  concepts: [],
  interpretations: [],
  clarificationQuestion: null,
  requiresClarification: false,
  confidence: 0.9,
  assumptions: [],
  suggestedMode: "unknown",
  matchedGroupId: null,
  brief: {
    summary: "Protective phone case",
    intendedUse: "FDM print",
    requiredFeatures: ["camera opening", "button openings"],
    explicitConstraints: [],
    acceptanceCriteria: ["camera opening is unobstructed"],
  },
};

describe("generation plan checkpoint", () => {
  test("builds a compact plan and restores it only for the same inputs", () => {
    const checkpoint = buildGenerationPlan({
      request: intelligence.rawRequest,
      family: "phone_case",
      parameterValues: { wall_thickness: 2 },
      parameterSchema: [{
        key: "wall_thickness", label: "Wall", kind: "float", unit: "mm",
        value: 2, min: 1.2, max: 4, step: 0.1, source: "user", editable: true,
        description: "Wall thickness", group: "engineering",
      }],
      intelligence,
    });
    const stored = JSON.stringify({ generation_plan: checkpoint });

    expect(checkpoint.plan.features.map((feature) => feature.name)).toEqual([
      "camera opening",
      "button openings",
    ]);
    expect(checkpoint.plan.constraints.dimensions.wall_thickness).toBe(2);
    expect(checkpoint.plan.constraints.manufacturing).toEqual({});
    expect(checkpoint.plan.constraints.geometry).toEqual({});
    expect(checkpoint.plan.modeling_plan).toEqual([]);
    expect(checkpoint.plan.validation_targets.required_feature_checks).toEqual(["camera opening is unobstructed"]);
    expect(restoreGenerationPlan(stored, checkpoint.fingerprint)).toEqual(checkpoint);
    expect(restoreGenerationPlan(stored, "different-input-fingerprint")).toBeNull();
    expect(restoreGenerationPlan(JSON.stringify({ generation_plan: { ...checkpoint, schema_version: 1 } }), checkpoint.fingerprint)).toBeNull();
  });

  test("preserves explicit assembly constraints without imposing printability or one body", () => {
    const checkpoint = buildGenerationPlan({
      request: "two moving parts for display",
      family: "unknown",
      parameterValues: {},
      parameterSchema: [],
      intelligence: {
        ...intelligence,
        rawRequest: "two moving parts for display",
        brief: {
          summary: "Two moving parts",
          intendedUse: "display",
          requiredFeatures: ["moving joint"],
          explicitConstraints: ["two separate moving parts"],
          acceptanceCriteria: ["parts can move independently"],
        },
      },
    });
    expect(checkpoint.plan.constraints.explicit_constraints).toEqual(["two separate moving parts"]);
    expect(checkpoint.plan.constraints.manufacturing.printable).toBeUndefined();
    expect(checkpoint.plan.validation_targets.required_feature_checks).toEqual(["parts can move independently"]);
    expect(checkpoint.plan.modeling_plan).toEqual([]);
  });
});
