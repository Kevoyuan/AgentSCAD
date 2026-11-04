import { createHash } from "crypto";
import { measureCircularSections } from "../geometry/circular-section";
import { checkSliderCrank } from "./slider-crank-check";
import type { Vec3 } from "../geometry/stl-mesh";

export interface SliderCrankGeometryContract {
  crankRadiusMm: number;
  rodLengthMm: number;
  toleranceMm: number;
  /** Slice in the XZ plane, across the pin/rod engagement region. */
  sectionYmm: number;
  /** Optional second slice this far along +Y, used to test pin-axis parallelism. */
  axisProbeMm?: number;
  pinRadiusMm: { min: number; max: number };
  rodBoreRadiusMm: { min: number; max: number };
}

/** Measures actual contour centres, then independently compares their motion
 * and linkage closure. No source variables, declared poses or echoed positions
 * are accepted as observations. A contour's functional identity is still an
 * assumption of the selector and radius window, not a proven semantic fact.
 */
export function measureSliderCrankGeometry(input: {
  angleDegrees: number;
  contract: SliderCrankGeometryContract;
  meshes: { crank: Buffer; rod: Buffer; slider: Buffer };
}) {
  const { contract, meshes, angleDegrees } = input;
  const hashes = Object.fromEntries(Object.entries(meshes).map(([id, mesh]) => [id, createHash("sha256").update(mesh).digest("hex")]));
  const base = { angleDegrees, hashes, sectionYmm: contract.sectionYmm };
  try {
    // Validate the independent oracle before interpreting any measurements.
    checkSliderCrank({ ...contract, requiredAngles: [angleDegrees], samples: [] });
    const section = (stl: Buffer, radiusMm: { min: number; max: number }) => measureCircularSections({
      stl, origin: [0, contract.sectionYmm, 0], normal: [0, 1, 0], radiusMm,
    });
    const crank = section(meshes.crank, contract.pinRadiusMm);
    const slider = section(meshes.slider, contract.pinRadiusMm);
    const rod = section(meshes.rod, contract.rodBoreRadiusMm);
    if (crank.circles.length !== 1 || slider.circles.length !== 1 || rod.circles.length !== 2) {
      return { ...base, status: "ERROR" as const, reason: "Expected one crank pin, one slider pin and two rod bore contours within the frozen radius windows.",
        contourCounts: { crank: crank.circles.length, slider: slider.circles.length, rod: rod.circles.length } };
    }
    const cp = crank.circles[0].center, sp = slider.circles[0].center;
    const [ra, rb] = rod.circles.map(c => c.center);
    const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, k) => value - b[k]));
    const couplingErrorMm = Math.min(Math.max(distance(ra, cp), distance(rb, sp)), Math.max(distance(rb, cp), distance(ra, sp)));
    const rodLengthMm = distance(ra, rb);
    const comparison = checkSliderCrank({ ...contract, requiredAngles: [angleDegrees], samples: [{
      angleDegrees, crankPin: [cp[0], cp[2]], pistonPin: [sp[0], sp[2]],
    }] })[0];
    const maxErrorMm = Math.max(comparison.maxErrorMm!, couplingErrorMm, Math.abs(rodLengthMm - contract.rodLengthMm));
    return {
      ...base, status: maxErrorMm <= contract.toleranceMm ? "PASS" as const : "FAIL" as const,
      reason: "Measured pin/bore centres at this slice and input angle only; collision, retention, topology and physical function are not checked.",
      crankPin: cp, pistonPin: sp, rodBores: [ra, rb], rodLengthMm, couplingErrorMm,
      maxErrorMm, positionalErrorMm: comparison.maxErrorMm,
    };
  } catch (error) {
    return { ...base, status: "ERROR" as const, reason: error instanceof Error ? error.message : "Geometry measurement failed" };
  }
}
