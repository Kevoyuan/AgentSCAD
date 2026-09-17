import { describe, expect, test } from "bun:test";
import { writeScadParameters } from "../scad-parameter-writer";

describe("writeScadParameters", () => {
  test("replaces top-level numeric and string assignments while keeping comments", () => {
    const original = `// Part dimensions
wall_thickness = 2; // in mm
part_name = "stand"; /* legacy */
box_height = 40;

module body() {
  wall_thickness = 10; // inner scope should not be touched
  cube([box_height, 20, wall_thickness]);
}
body();
`;

    const updated = writeScadParameters(original, {
      wall_thickness: 3.5,
      part_name: "custom_stand",
      box_height: 50,
    });

    expect(updated).toContain("wall_thickness = 3.5; // in mm");
    expect(updated).toContain('part_name = "custom_stand"; /* legacy */');
    expect(updated).toContain("box_height = 50;");
    expect(updated).toContain("  wall_thickness = 10; // inner scope should not be touched");
  });

  test("does not touch assignments inside strings or comments", () => {
    const original = `// comment with foo = 123;
label = "width = 99; do not change";
width = 10;
`;

    const updated = writeScadParameters(original, {
      width: 25,
    });

    expect(updated).toContain('// comment with foo = 123;');
    expect(updated).toContain('label = "width = 99; do not change";');
    expect(updated).toContain("width = 25;");
  });

  test("prepends missing parameter definitions at the top", () => {
    const original = `cube([10, 10, 10]);`;

    const updated = writeScadParameters(original, {
      extra_radius: 5,
    });

    expect(updated.startsWith("extra_radius = 5;\n")).toBe(true);
    expect(updated).toContain("cube([10, 10, 10]);");
  });

  test("rejects invalid parameter names or unsupported values", () => {
    expect(() => writeScadParameters("a = 1;", { "invalid-name": 2 })).toThrow();
    expect(() => writeScadParameters("a = 1;", { a: {} })).toThrow();
    expect(() => writeScadParameters("a = 1;", { a: NaN })).toThrow();
  });
});
