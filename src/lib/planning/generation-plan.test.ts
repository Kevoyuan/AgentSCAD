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
    expect(restoreGenerationPlan(stored, checkpoint.fingerprint)).toEqual(checkpoint);
    expect(restoreGenerationPlan(stored, "different-input-fingerprint")).toBeNull();
  });
});
