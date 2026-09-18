import { describe, expect, test } from "bun:test";
import { checkCompile } from "@/lib/validation/compile-check";

function renderLog(overrides: Partial<Parameters<typeof checkCompile>[0]> = {}) {
  return {
    openscad_version: "real",
    render_time_ms: 3699,
    stl_triangles: 2536,
    stl_vertices: 0,
    png_resolution: "800x600",
    warnings: [] as string[],
    ...overrides,
  };
}

describe("C001 OpenSCAD compile check", () => {
  test("fails when OpenSCAD ignored a library include", () => {
    const result = checkCompile(
      renderLog({
        warnings: [
          "WARNING: Can't open include file 'agentscad_std.scad'.",
          "WARNING: Ignoring unknown module 'mounting_plate' in file model.scad , line 4",
        ],
      })
    );

    expect(result.passed).toBe(false);
    expect(result.status).toBe("FAIL");
    expect(result.is_critical).toBe(true);
    expect(result.message).toContain("ignored unresolved library code");
  });

  test("still fails a genuinely empty mesh", () => {
    const result = checkCompile(renderLog({ stl_triangles: 0 }));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("empty mesh");
  });

  test("passes a clean render with counted triangles", () => {
    const result = checkCompile(renderLog());
    expect(result.passed).toBe(true);
    expect(result.status).toBe("PASS");
    expect(result.message).toContain("2536 triangles");
  });

  test("keeps unrelated warnings non-critical", () => {
    const result = checkCompile(renderLog({ warnings: ["WARNING: something cosmetic"] }));
    expect(result.passed).toBe(true);
    expect(result.status).toBe("WARN");
    expect(result.is_critical).toBe(false);
  });
});
