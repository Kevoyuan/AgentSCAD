// ---------------------------------------------------------------------------
// B001 — Bounding Box Match Check
//
// Compares the rendered mesh bounding box against the validation_targets
// from the structured generation output.
// ---------------------------------------------------------------------------

import type { ValidationCheck } from "./validation-types";
import type { RawMeshData } from "./validation-types";

const BBOX_TOLERANCE_MM = 3; // acceptable deviation in mm per axis

export function checkBoundingBox(
  meshData: RawMeshData,
  expectedBbox: number[] | undefined
): ValidationCheck {
  if (!meshData.bbox) {
    return {
      rule_id: "B001",
      rule_name: "Bounding Box Match",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: "Skipped — no mesh bounding box available",
    };
  }

  if (!expectedBbox || expectedBbox.length < 3) {
    return {
      rule_id: "B001",
      rule_name: "Bounding Box Match",
      level: "INFO",
      passed: true,
      is_critical: false,
      message: "Skipped — no expected bounding box specified in validation targets",
      details: {
        actual: [meshData.bbox.length, meshData.bbox.width, meshData.bbox.height],
      },
    };
  }

  const actual = [meshData.bbox.length, meshData.bbox.width, meshData.bbox.height];
  const expected = expectedBbox.slice(0, 3);

  const deviations = actual.map((a, i) => Math.abs(a - expected[i]));
  const maxDeviation = Math.max(...deviations);
  const withinTolerance = deviations.every((d) => d <= BBOX_TOLERANCE_MM);

  if (withinTolerance) {
    return {
      rule_id: "B001",
      rule_name: "Bounding Box Match",
      level: "ENGINEERING",
      passed: true,
      is_critical: false,
      message: `Bbox matches expected: actual [${actual.join(", ")}] vs expected [${expected.join(", ")}] (±${BBOX_TOLERANCE_MM}mm tolerance)`,
      details: { actual, expected, deviations, tolerance: BBOX_TOLERANCE_MM },
    };
  }

  const axisLabels = ["X", "Y", "Z"];
  const failingAxes = deviations
    .map((d, i) => (d > BBOX_TOLERANCE_MM ? `${axisLabels[i]}: ${d.toFixed(1)}mm off` : null))
    .filter(Boolean);

  return {
    rule_id: "B001",
    rule_name: "Bounding Box Match",
    level: "ENGINEERING",
    passed: false,
    is_critical: true,
    message: `Bbox mismatch: actual [${actual.join(", ")}] vs expected [${expected.join(", ")}]. ` +
      `Deviations: ${failingAxes.join(", ")}. Max deviation: ${maxDeviation.toFixed(1)}mm`,
    details: { actual, expected, deviations, tolerance: BBOX_TOLERANCE_MM, failingAxes },
  };
}
