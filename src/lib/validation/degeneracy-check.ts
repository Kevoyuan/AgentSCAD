// ---------------------------------------------------------------------------
// B002 — Degenerate Geometry Sanity
//
// Catches "zero-material" solids that pass every other deterministic check.
// Two coplanar faces (or a near-zero-thickness hull) render as a watertight
// volume with a valid bounding box, so R001 (wall thickness), R003 (manifold)
// and B001 (bbox match) see nothing wrong. The result is printing waste.
//
// Flag a component whose smallest bounding-box extent is below a manufacturing
// floor AND whose enclosed volume is effectively nil. Requiring BOTH guards
// against false positives on genuinely thin-but-real parts (e.g. a 0.2 mm shim
// with 80 mm³ of material), which remain legitimate geometry.
// ---------------------------------------------------------------------------

import type { ValidationCheck, RawMeshData } from "./validation-types";

const DEGENERATE_MIN_EXTENT_MM = 0.3; // below a typical FDM minimum feature
const DEGENERATE_VOLUME_MM3 = 1.0;

export function checkDegenerateGeometry(meshData: RawMeshData): ValidationCheck {
  if (!meshData.bbox) {
    return {
      rule_id: "B002",
      rule_name: "Degenerate Geometry Sanity",
      level: "ENGINEERING",
      passed: true,
      status: "SKIP",
      is_critical: false,
      message: "Skipped — no bounding box available from mesh analysis",
    };
  }

  if (meshData.volume == null) {
    return {
      rule_id: "B002",
      rule_name: "Degenerate Geometry Sanity",
      level: "ENGINEERING",
      passed: true,
      status: "SKIP",
      is_critical: false,
      message: "Skipped — volume unavailable (non-watertight mesh; manifold check governs)",
      details: { isWatertight: meshData.isWatertight },
    };
  }

  const extents = [meshData.bbox.length, meshData.bbox.width, meshData.bbox.height];
  const minExtent = Math.min(...extents);
  const volume = meshData.volume;

  if (minExtent < DEGENERATE_MIN_EXTENT_MM && volume < DEGENERATE_VOLUME_MM3) {
    return {
      rule_id: "B002",
      rule_name: "Degenerate Geometry Sanity",
      level: "ENGINEERING",
      passed: false,
      status: "FAIL",
      is_critical: true,
      message:
        `Degenerate component: smallest dimension ${minExtent.toFixed(4)}mm (<${DEGENERATE_MIN_EXTENT_MM}mm) ` +
        `and enclosed volume ${volume.toFixed(4)}mm³ (<${DEGENERATE_VOLUME_MM3}mm³). ` +
        `The part is effectively zero-material — likely a near-zero-thickness hull or coincident faces. ` +
        `Ensure generated geometry has real wall thickness.`,
      details: {
        minExtent,
        volume,
        extents,
        thresholds: { minExtentMm: DEGENERATE_MIN_EXTENT_MM, volumeMm3: DEGENERATE_VOLUME_MM3 },
      },
    };
  }

  return {
    rule_id: "B002",
    rule_name: "Degenerate Geometry Sanity",
    level: "ENGINEERING",
    passed: true,
    status: "PASS",
    is_critical: false,
    message: `Component has non-degenerate extent (min ${minExtent.toFixed(2)}mm) and volume (${volume.toFixed(2)}mm³)`,
    details: { minExtent, volume, extents },
  };
}
