import { describe, expect, test } from "bun:test";
import {
  extractJsonObjectText,
  extractOpenScadCodeFromText,
  normalizeGenerationResult,
  stripReasoningTags,
} from "@/lib/harness/structured-output";
import type { ParameterDef } from "@/lib/harness/types";

const fallbackParameters: ParameterDef[] = [
  {
    key: "width",
    label: "Width",
    kind: "float",
    unit: "mm",
    value: 50,
    min: 1,
    max: 100,
    step: 1,
    source: "user",
    editable: true,
    description: "Width",
    group: "geometry",
  },
];

describe("structured-output parser", () => {
  test("strips reasoning <think> tags including unclosed tags", () => {
    const rawWithThink = "<think>\nAnalyzing CAD geometry...\n</think>\n{\"summary\":\"box\"}";
    expect(stripReasoningTags(rawWithThink)).toBe("{\"summary\":\"box\"}");

    const unclosedThink = "<think>\nDrafting OpenSCAD...\n{ \"summary\": \"box\" }";
    expect(stripReasoningTags(unclosedThink)).toBe("");
  });

  test("parses standard v2.0 two-part format", () => {
    const raw = `
{
  "part_type": "electronics_enclosure",
  "summary": "Custom Enclosure Box",
  "features": [{"name": "shell", "type": "enclosure"}]
}

\`\`\`scad
include <agentscad_std.scad>;

width = 50;
module generated_part() {
  cube([width, 30, 20]);
}
generated_part();
\`\`\`
`;
    const result = normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    expect(result.part_type).toBe("electronics_enclosure");
    expect(result.summary).toBe("Custom Enclosure Box");
    expect(result.scad_source).toContain("module generated_part()");
  });

  test("handles response with <think> reasoning tags before JSON and SCAD", () => {
    const raw = `
<think>
Need to create a parametric smartphone case.
Dimensions are { width: 75, height: 150 }.
</think>

{
  "part_type": "phone_case",
  "summary": "iPhone 18 Case"
}

\`\`\`scad
module phone_case() {
  cube([150, 75, 8]);
}
\`\`\`
`;
    const result = normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    expect(result.part_type).toBe("phone_case");
    expect(result.summary).toBe("iPhone 18 Case");
    expect(result.scad_source).toContain("cube([150, 75, 8]);");
  });

  test("extracts SCAD from unclosed code fence at EOF (LLM output truncation)", () => {
    const raw = `
{
  "part_type": "phone_case",
  "summary": "Truncated SCAD Response"
}

\`\`\`scad
include <agentscad_std.scad>;

module generated_part() {
  difference() {
    cube([147, 71, 8]);
    cylinder(r=5, h=10);
// output truncated here without closing backticks
`;
    const result = normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    expect(result.part_type).toBe("phone_case");
    expect(result.scad_source).toContain("difference()");
  });

  test("preserves SCAD code fence when JSON lacks v2 part_type/features fields", () => {
    const raw = `
Here is the requested CAD model:

{
  "summary": "Simple Bracket",
  "notes": "Custom mounting plate"
}

\`\`\`scad
module bracket() {
  translate([0, 0, 0]) cube([40, 20, 5]);
}
\`\`\`
`;
    const result = normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    expect(result.summary).toBe("Simple Bracket");
    expect(result.scad_source).toContain("cube([40, 20, 5]);");
  });

  test("scores and extracts minimal OpenSCAD snippet calling standard library or module", () => {
    const raw = `
\`\`\`scad
include <agentscad_std.scad>;
generated_part();
\`\`\`
`;
    const scad = extractOpenScadCodeFromText(raw);
    expect(scad).toContain("generated_part();");
  });

  test("throws explicit error when response contains neither valid JSON nor OpenSCAD", () => {
    const raw = "I am sorry, but as an AI model I cannot generate CAD models for non-physical concepts.";
    expect(() => normalizeGenerationResult(raw, fallbackParameters, "Default Summary")).toThrow(
      "LLM response was neither valid structured JSON nor recognizable OpenSCAD"
    );
    try {
      normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    } catch (e: any) {
      expect(e.name).toBe("CadGenerationFormatError");
      expect(e.responseLength).toBe(raw.length);
      expect(e.snippet).toContain("I am sorry");
    }
  });

  test("extracts SCAD when preceded by other markdown blocks like json or plan", () => {
    const raw = `
\`\`\`json
{ "note": "this is metadata only" }
\`\`\`

Here is the code:
\`\`\`scad
include <agentscad_std.scad>;
width = 60;
module generated_part() {
  enclosure_box(width, 40, 20);
}
generated_part();
\`\`\`
`;
    const result = normalizeGenerationResult(raw, fallbackParameters, "Default Summary");
    expect(result.scad_source).toContain("enclosure_box(width, 40, 20);");
  });
});
