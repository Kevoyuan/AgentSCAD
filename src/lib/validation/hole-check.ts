// ---------------------------------------------------------------------------
// H001 — Through-Hole Count Check
//
// Estimates the number of through-holes in a watertight mesh using the
// Euler characteristic: genus = (2 - euler) / 2.
//
// Only meaningful for watertight meshes. For non-watertight meshes,
// the check is skipped with an explanation.
// ---------------------------------------------------------------------------

import type { ValidationCheck, RawMeshData } from "./validation-types";

export function checkHoleCount(
  meshData: RawMeshData,
  expectedMinHoles?: number
): ValidationCheck {
  if (!meshData.isWatertight) {
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: "Skipped — mesh is not watertight; Euler-based hole detection is unreliable",
      details: { isWatertight: false },
    };
  }

  const { genus, vertices, faces, edges } = meshData;
  const euler = vertices - edges + faces;

  if (genus === 0) {
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: `No through-holes detected (genus=0, euler=${euler})`,
      details: { genus, euler, vertices, faces, edges },
    };
  }

  if (expectedMinHoles !== undefined && genus < expectedMinHoles) {
    return {
      rule_id: "H001",
      rule_name: "Through-Hole Count",
      level: "ENGINEERING",
      passed: false,
      is_critical: true,
      message: `Expected at least ${expectedMinHoles} through-hole(s), but detected only ${genus}. ` +
        `Check that hole-generating cylinders fully penetrate the part body in difference().`,
      details: { genus, euler, expectedMinHoles, vertices, faces, edges },
    };
  }

  const expectedText = expectedMinHoles !== undefined
    ? ` (expected ≥ ${expectedMinHoles})`
    : "";

  return {
    rule_id: "H001",
    rule_name: "Through-Hole Count",
    level: "ENGINEERING",
    passed: expectedMinHoles === undefined || genus >= expectedMinHoles,
    is_critical: expectedMinHoles !== undefined,
    message: `Detected ${genus} through-hole(s)${expectedText} (genus=${genus}, euler=${euler})`,
    details: { genus, euler, vertices, faces, edges, expectedMinHoles },
  };
}
