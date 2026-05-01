// ---------------------------------------------------------------------------
// C002 — Connected Components Check
//
// Verifies that the mesh is a single connected solid with no floating parts.
// ---------------------------------------------------------------------------

import type { ValidationCheck, RawMeshData } from "./validation-types";

export function checkComponents(meshData: RawMeshData): ValidationCheck {
  const { componentCount, isWatertight, isVolume } = meshData;

  if (componentCount === 0) {
    return {
      rule_id: "C002",
      rule_name: "Connected Components",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: "Skipped — component count not available from mesh analysis",
    };
  }

  if (componentCount === 1) {
    const extra = isWatertight
      ? "watertight"
      : isVolume
        ? "solid volume (not watertight)"
        : "connected";
    return {
      rule_id: "C002",
      rule_name: "Connected Components",
      level: "ENGINEERING",
      passed: true,
      is_critical: true,
      message: `Single ${extra} body, no floating parts detected`,
      details: { componentCount, isWatertight, isVolume },
    };
  }

  if (componentCount > 1 && componentCount <= 3) {
    return {
      rule_id: "C002",
      rule_name: "Connected Components",
      level: "ENGINEERING",
      passed: false,
      is_critical: true,
      message: `Mesh has ${componentCount} disconnected components. ` +
        `Floating parts detected — the model would print as separate pieces. ` +
        `Ensure all geometry is unioned inside generated_part().`,
      details: { componentCount, isWatertight, isVolume },
    };
  }

  return {
    rule_id: "C002",
    rule_name: "Connected Components",
    level: "ENGINEERING",
    passed: false,
    is_critical: true,
    message: `Mesh has ${componentCount} disconnected components — severe fragmentation. ` +
      `Possible boolean operation errors or missing union().`,
    details: { componentCount, isWatertight, isVolume },
  };
}
