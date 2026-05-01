// ---------------------------------------------------------------------------
// C001 — OpenSCAD Compile Check
//
// Validates that the generated SCAD code compiled successfully.
// Consumes the render log produced by scad-renderer.ts.
// ---------------------------------------------------------------------------

import type { ValidationCheck } from "./validation-types";

export function checkCompile(renderLog: {
  openscad_version: string;
  render_time_ms: number;
  stl_triangles: number;
  stl_vertices: number;
  png_resolution: string | null;
  warnings: string[];
}): ValidationCheck {
  const hasWarnings = renderLog.warnings.length > 0;
  const hasError = renderLog.openscad_version === "error";
  const hasTriangles = renderLog.stl_triangles > 0;

  if (hasError) {
    return {
      rule_id: "C001",
      rule_name: "OpenSCAD Compile",
      level: "ENGINEERING",
      passed: false,
      is_critical: true,
      message: `OpenSCAD compilation failed: ${renderLog.warnings.join("; ")}`,
      details: { renderLog },
    };
  }

  if (!hasTriangles && renderLog.openscad_version !== "error") {
    return {
      rule_id: "C001",
      rule_name: "OpenSCAD Compile",
      level: "ENGINEERING",
      passed: false,
      is_critical: true,
      message: "OpenSCAD compiled but produced an empty mesh (0 triangles)",
      details: { renderLog },
    };
  }

  if (hasWarnings) {
    return {
      rule_id: "C001",
      rule_name: "OpenSCAD Compile",
      level: "MANUFACTURING",
      passed: true,
      is_critical: false,
      message: `Compiled with ${renderLog.warnings.length} warning(s): ${renderLog.warnings.join("; ")}`,
      details: { renderLog },
    };
  }

  return {
    rule_id: "C001",
    rule_name: "OpenSCAD Compile",
    level: "ENGINEERING",
    passed: true,
    is_critical: true,
    message: `Compiled successfully in ${renderLog.render_time_ms}ms, ${renderLog.stl_triangles} triangles`,
    details: { renderLog },
  };
}
