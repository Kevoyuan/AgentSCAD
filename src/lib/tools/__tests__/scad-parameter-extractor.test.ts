import { describe, expect, test } from "bun:test";
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
  withSourceParameterMetadata,
} from "@/lib/tools/scad-parameter-extractor";

describe("scad-parameter-extractor", () => {
  test("numeric literals and prose supply hints while source annotations retain constraints", () => {
    const [free, explicit, partial] = extractParameterDefsFromScad(`
axial_offset = 0; // working axial displacement
bounded = 0; // [-1:0.1:10]
lower_only = 1; // min: 0
`);
    expect(free).toMatchObject({ kind: "float", value: 0, numericConstraints: {} });
    expect(explicit.numericConstraints).toEqual({ min: -1, max: 10, step: 0.1 });
    expect(partial.numericConstraints).toEqual({ min: 0 });
    const legacy = { ...free, kind: "integer", min: 0, max: 100, step: 1, numericConstraints: undefined };
    expect(withSourceParameterMetadata([legacy], "axial_offset = 0; // working axial displacement")[0])
      .toMatchObject({ kind: "float", numericConstraints: {} });
    for (const changed of [{ ...legacy, source: "user" }, { ...legacy, min: -2 }, { ...legacy, description: "custom limits" }]) {
      expect(withSourceParameterMetadata([changed], "axial_offset = 0; // working axial displacement")[0]).toBe(changed);
    }
  });
  test("retains literal boolean controls as booleans through persistence", async () => {
    const { buildScadParameterPersistence } = await import("../scad-parameter-persistence");
    const result = buildScadParameterPersistence(`
/*
false_control = true;
*/
hinge_angle = 0;
show_angle_clamp = true; // Keep working angle within its range
release_mode = false;
module body() { inner_mode = true; }
`);
    expect(result.parameters.find(parameter => parameter.key === "show_angle_clamp"))
      .toMatchObject({ kind: "boolean", value: true, unit: "", editable: true });
    expect(JSON.parse(result.parameterValues)).toEqual({ hinge_angle: 0, show_angle_clamp: true, release_mode: false });
  });

  test("boolean backfill preserves reset defaults and rejects expression and comment controls", () => {
    const original = extractParameterDefsFromScad("release_mode = true;");
    expect(withSourceParameterMetadata(original, "release_mode = false;")[0].value).toBe(true);
    expect(withSourceParameterMetadata([], '// fake = true;\nlabel = "fake = true;";\nmode = !false;')).toEqual([]);
    const legacy = [{ key: "release_mode", kind: "boolean", value: 1 }];
    expect(withSourceParameterMetadata(legacy, "release_mode = false;")[0].value).toBe(false);
    expect(mergeExtractedParameters(original, [{ ...original[0], unit: "mm" }])[0].unit).toBe("");
  });
  test("extracts grouped top-level numeric assignments with explicit ranges", () => {
    const parameters = extractParameterDefsFromScad(`
/* [Dimensions] */
body_width = 72; // min: 40 max: 120 step: 0.5
body_height = 150; // min: 80 max: 220 step: 0.5

module body() {
  cube([body_width, body_height, 4]);
}
`);

    expect(parameters).toHaveLength(2);
    expect(parameters[0]).toMatchObject({
      key: "body_width",
      label: "Body Width",
      group: "Dimensions",
      value: 72,
      min: 40,
      max: 120,
      step: 0.5,
    });
    expect(parameters[1]).toMatchObject({
      key: "body_height",
      group: "Dimensions",
      value: 150,
      min: 80,
      max: 220,
      step: 0.5,
    });
  });

  test("stops extracting once geometry or module declarations begin", () => {
    const parameters = extractParameterDefsFromScad(`
wall_thickness = 2; // min: 1.2 max: 6 step: 0.1
module enclosure() {}
hidden_internal = 999;
`);

    expect(parameters.map((parameter) => parameter.key)).toEqual(["wall_thickness"]);
  });

  test("ignores reserved OpenSCAD keywords as editable parameters", () => {
    const parameters = extractParameterDefsFromScad(`
module = 3;
let = 4;
safe_width = 20;
`);

    expect(parameters.map((parameter) => parameter.key)).toEqual(["safe_width"]);
  });

  test("merges extracted parameters with existing schema metadata", () => {
    const extracted = extractParameterDefsFromScad(`
wall_thickness = 2.4;
`);
    const merged = mergeExtractedParameters(extracted, [
      {
        key: "wall_thickness",
        label: "Wall",
        kind: "float",
        unit: "mm",
        value: 2,
        min: 1.2,
        max: 8,
        step: 0.2,
        source: "user",
        editable: true,
        description: "Existing wall thickness control",
        group: "engineering",
      },
    ]);

    expect(merged[0]).toMatchObject({
      key: "wall_thickness",
      value: 2.4,
      min: 1.2,
      max: 8,
      step: 0.2,
      source: "user",
      description: "Existing wall thickness control",
    });
  });
});
