// B002 — near-zero material, measured independently for every connected shell.
// Oriented bounds preserve the result under rigid transforms; total mesh volume
// cannot hide a degenerate component beside a healthy one.
import type { ValidationCheck, RawMeshData } from "./validation-types";

const DEGENERATE_MIN_EXTENT_MM = 0.3;
const DEGENERATE_VOLUME_MM3 = 1.0;

export function checkDegenerateGeometry(meshData: RawMeshData): ValidationCheck {
  const base = {
    rule_id: "B002", rule_name: "Degenerate Geometry Sanity", level: "ENGINEERING" as const,
  };
  const components = meshData.componentGeometry;
  const measured = (components ?? []).filter((component) =>
    component.minExtent !== null && component.volume !== null &&
    Number.isFinite(component.minExtent) && Number.isFinite(component.volume) &&
    component.minExtent >= 0 && component.volume >= 0,
  );
  const degenerate = measured.filter((component) =>
    component.minExtent! < DEGENERATE_MIN_EXTENT_MM && component.volume! < DEGENERATE_VOLUME_MM3,
  );
  if (degenerate.length) {
    return {
      ...base, passed: false, status: "FAIL", is_critical: true,
      message: `Degenerate geometry: ${degenerate.length} component(s) have oriented extent <${DEGENERATE_MIN_EXTENT_MM}mm and volume <${DEGENERATE_VOLUME_MM3}mm³. Ensure generated geometry has real thickness.`,
      details: { components: degenerate, thresholds: { minExtentMm: DEGENERATE_MIN_EXTENT_MM, volumeMm3: DEGENERATE_VOLUME_MM3 } },
    };
  }
  if (!components?.length || measured.length !== components.length || components.length !== meshData.componentCount) {
    return {
      ...base, passed: false, status: "SKIP", is_critical: false,
      message: "Skipped — rotation-independent extent or enclosed volume unavailable for one or more components",
    };
  }
  return {
    ...base, passed: true, status: "PASS", is_critical: false,
    message: `No near-zero-material geometry detected in ${measured.length} component(s)`,
    details: { components: measured },
  };
}
