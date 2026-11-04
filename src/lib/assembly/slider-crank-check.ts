type Point = [number, number];
export type SliderCrankSample = { angleDegrees: number; crankPin: Point; pistonPin: Point };
type Result = { angleDegrees: number; status: "PASS" | "FAIL" | "NOT_RUN"; maxErrorMm?: number; reason: string };

/**
 * Compare supplied 2D pin coordinates against an independently specified,
 * centered slider-crank. Coordinates are in the crank plane, with the crank
 * center at (0,0), the slider along +z, and zero angle at +z. The positive
 * branch is assumed. This does not extract coordinates from an STL or prove
 * collisions, connectivity, 3D motion, or behavior between requested samples.
 */
export function checkSliderCrank(input: {
  crankRadiusMm: number; rodLengthMm: number; toleranceMm: number;
  requiredAngles: number[]; samples: SliderCrankSample[];
}): Result[] {
  const { crankRadiusMm: r, rodLengthMm: length, toleranceMm: tolerance, requiredAngles, samples } = input;
  if (![r, length, tolerance].every(Number.isFinite) || r <= 0 || length <= r || tolerance < 0 ||
      !Array.isArray(requiredAngles) || requiredAngles.length === 0 || requiredAngles.some(a => !Number.isFinite(a)) ||
      new Set(requiredAngles).size !== requiredAngles.length || !Array.isArray(samples)) {
    throw new Error("Invalid slider-crank contract");
  }
  const measurements = new Map<number, SliderCrankSample>();
  for (const sample of samples) {
    const validPoint = (point: Point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
    if (!sample || !Number.isFinite(sample.angleDegrees) || !requiredAngles.includes(sample.angleDegrees) || measurements.has(sample.angleDegrees) || !validPoint(sample.crankPin) || !validPoint(sample.pistonPin)) {
      throw new Error("Invalid, duplicate, or unexpected slider-crank measurement");
    }
    measurements.set(sample.angleDegrees, sample);
  }
  return requiredAngles.map((angle): Result => {
    const sample = measurements.get(angle);
    if (!sample) return { angleDegrees: angle, status: "NOT_RUN", reason: "No pin coordinates supplied for this angle." };
    const radians = angle * Math.PI / 180;
    const x = r * Math.sin(radians);
    const z = r * Math.cos(radians);
    const pistonZ = z + Math.sqrt(length * length - x * x);
    const crankError = Math.hypot(sample.crankPin[0] - x, sample.crankPin[1] - z);
    const pistonError = Math.hypot(sample.pistonPin[0], sample.pistonPin[1] - pistonZ);
    const maxErrorMm = Math.max(crankError, pistonError);
    return {
      angleDegrees: angle,
      status: maxErrorMm <= tolerance ? "PASS" : "FAIL",
      maxErrorMm,
      reason: "Comparison of supplied planar pin positions only; no geometry, collision or continuous-range proof.",
    };
  });
}
