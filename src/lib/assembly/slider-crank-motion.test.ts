import { describe, expect, test } from "bun:test";
import { mergeStl } from "../geometry/__tests__/solids";
import { fitCircleXZ, measureSliderCrankMotion } from "./slider-crank-motion";

/**
 * These fixtures are synthetic parts, not a model reply. Their pin and bore
 * positions come from the same formula the checker compares against, so a
 * positive result only proves the measurement path is self-consistent. The
 * independent evidence is the native OpenSCAD test, where the source places
 * the parts and the checker never sees the formula.
 */

function stlFrom(triangles: number[][][]): Buffer {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const start = 84 + 50 * index + 12;
    triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
  });
  return buffer;
}

function ring(radius: number, y: number, segments: number, x: number, z: number, shearXPerY: number): number[][] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return [x + shearXPerY * y + radius * Math.cos(angle), y, z + radius * Math.sin(angle)];
  });
}

/** Solid cylinder whose axis is +Y, optionally sheared so the axis tilts. */
function yCylinderStl(options: {
  radius: number; y0: number; y1: number; x?: number; z?: number; shearXPerY?: number; segments?: number;
}): Buffer {
  const { radius, y0, y1, x = 0, z = 0, shearXPerY = 0, segments = 64 } = options;
  const bottom = ring(radius, y0, segments, x, z, shearXPerY);
  const top = ring(radius, y1, segments, x, z, shearXPerY);
  const centreBottom = [x + shearXPerY * y0, y0, z], centreTop = [x + shearXPerY * y1, y1, z];
  const triangles: number[][][] = [];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    triangles.push([bottom[index], bottom[next], top[next]], [bottom[index], top[next], top[index]]);
    triangles.push([centreBottom, bottom[next], bottom[index]]);
    triangles.push([centreTop, top[index], top[next]]);
  }
  return stlFrom(triangles);
}

/** Hollow cylinder whose axis is +Y: one annulus per section. */
function yTubeStl(options: {
  outerRadius: number; innerRadius: number; y0: number; y1: number; x?: number; z?: number; shearXPerY?: number; segments?: number;
}): Buffer {
  const { outerRadius, innerRadius, y0, y1, x = 0, z = 0, shearXPerY = 0, segments = 64 } = options;
  const ob = ring(outerRadius, y0, segments, x, z, shearXPerY), ot = ring(outerRadius, y1, segments, x, z, shearXPerY);
  const ib = ring(innerRadius, y0, segments, x, z, shearXPerY), it = ring(innerRadius, y1, segments, x, z, shearXPerY);
  const triangles: number[][][] = [];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    triangles.push([ob[index], ob[next], ot[next]], [ob[index], ot[next], ot[index]]);
    triangles.push([ib[index], it[next], ib[next]], [ib[index], it[index], it[next]]);
    triangles.push([ob[index], ib[next], ob[next]], [ob[index], ib[index], ib[next]]);
    triangles.push([ot[index], ot[next], it[next]], [ot[index], it[next], it[index]]);
  }
  return stlFrom(triangles);
}

/** Cylinder whose axis is +X, used only to prove a wrong pin axis is refused. */
function xCylinderStl(options: { radius: number; x0: number; x1: number; y: number; z: number; segments?: number }): Buffer {
  const { radius, x0, x1, y, z, segments = 64 } = options;
  const ringAt = (x: number) => Array.from({ length: segments }, (_, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return [x, y + radius * Math.cos(angle), z + radius * Math.sin(angle)];
  });
  const left = ringAt(x0), right = ringAt(x1);
  const triangles: number[][][] = [];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    triangles.push([left[index], left[next], right[next]], [left[index], right[next], right[index]]);
    triangles.push([[x0, y, z], left[next], left[index]]);
    triangles.push([[x1, y, z], right[index], right[next]]);
  }
  return stlFrom(triangles);
}

const CRANK_RADIUS = 8;
const ROD_LENGTH = 28;
const PIN = { min: 1.95, max: 2.05 };
const BORE = { min: 2.15, max: 2.25 };

const contract = {
  crankRadiusMm: CRANK_RADIUS,
  rodLengthMm: ROD_LENGTH,
  toleranceMm: 0.05,
  sectionYmm: 2,
  axisProbeMm: 1,
  pinRadiusMm: PIN,
  rodBoreRadiusMm: BORE,
};

interface PoseOptions {
  crankRadius?: number;
  rodLength?: number;
  phaseMm?: number;
  pinAxis?: "y" | "x" | "tilt";
  stretchMm?: (radians: number) => number;
}

function poseAt(angleDegrees: number, options: PoseOptions = {}) {
  const crankRadius = options.crankRadius ?? CRANK_RADIUS;
  const rodLength = options.rodLength ?? ROD_LENGTH;
  const radians = (angleDegrees * Math.PI) / 180;
  const cx = crankRadius * Math.sin(radians);
  const cz = crankRadius * Math.cos(radians);
  const px = 0;
  const pz = cz + Math.sqrt(ROD_LENGTH * ROD_LENGTH - cx * cx) + (options.phaseMm ?? 0);

  const shear = options.pinAxis === "tilt" ? 0.2 : 0;
  const crank = options.pinAxis === "x"
    // The pin exists and is round, but its axis is +X instead of +Y.
    ? xCylinderStl({ radius: 2, x0: cx - 6, x1: cx + 6, y: contract.sectionYmm, z: cz })
    : yCylinderStl({ radius: 2, y0: -0.1, y1: 6, x: cx, z: cz, shearXPerY: shear });

  const effectiveRodLength = rodLength + (options.stretchMm?.(radians) ?? 0);
  const dirX = px - cx, dirZ = pz - cz;
  const dirLength = Math.hypot(dirX, dirZ);
  const boreX = cx + (dirX / dirLength) * effectiveRodLength;
  const boreZ = cz + (dirZ / dirLength) * effectiveRodLength;
  const rod = mergeStl(
    yTubeStl({ outerRadius: 4, innerRadius: 2.2, y0: 1, y1: 4, x: cx, z: cz, shearXPerY: shear }),
    yTubeStl({ outerRadius: 4, innerRadius: 2.2, y0: 1, y1: 4, x: boreX, z: boreZ, shearXPerY: shear }),
  );
  const slider = yCylinderStl({ radius: 2, y0: 0, y1: 5.1, x: px, z: pz, shearXPerY: shear });
  return { angleDegrees, meshes: { crank, rod, slider } };
}

const poses = (count = 12, options: PoseOptions = {}) =>
  Array.from({ length: count }, (_, index) => poseAt((360 / count) * index, options));

describe("circle fit", () => {
  test("recovers a known centre and radius from three points", () => {
    const fit = fitCircleXZ([[5, 0], [0, 5], [-5, 0], [0, -5]]);
    expect(fit).not.toBeNull();
    expect(fit!.centerXZ[0]).toBeCloseTo(0, 9);
    expect(fit!.centerXZ[1]).toBeCloseTo(0, 9);
    expect(fit!.radiusMm).toBeCloseTo(5, 9);
    expect(fit!.residualMm).toBeLessThan(1e-9);
  });

  test("a straight line defines no unique circle", () => {
    expect(fitCircleXZ([[0, -5], [0, 0], [0, 5]])).toBeNull();
    expect(fitCircleXZ([[0, 0], [1, 1]])).toBeNull();
  });
});

describe("multi-pose slider-crank measurement", () => {
  test("twelve poses close against the analytic mechanism", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses() });
    expect(result.status).toBe("PASS");
    expect(result.poses).toHaveLength(12);
    expect(result.poses.every(pose => pose.status === "PASS")).toBe(true);
    expect(result.crank!.radiusMm).toBeCloseTo(CRANK_RADIUS, 3);
    expect(result.rodLengthMm!.spread).toBeLessThan(1e-3);
    expect(result.axisDriftMm).toBeLessThan(1e-3);
    expect(result.coverage.stepDeg).toBe(30);
    expect(result.coverage.slicesPerPose).toBe(2);
    expect(result.axisCheck.performed).toBe(true);
  });

  test("observations carry the artifact hash, method and coverage", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses() });
    const ids = result.observations.map(observation => observation.id);
    expect(ids).toEqual([
      "slider-crank-position-error-mm",
      "slider-crank-crank-radius-mm",
      "slider-crank-rod-length-spread-mm",
    ]);
    for (const observation of result.observations) {
      expect(observation.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(observation.method.length).toBeGreaterThan(10);
      expect(observation.coverage).toContain("12 poses");
      expect(observation.uncertainty).toBeGreaterThan(0);
    }
    expect(result.observations[0].value).toBeLessThan(1e-3);
    expect(result.observations[2].value).toBeLessThan(1e-3);
  });

  test("a crank of the wrong radius is measured, not followed", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses(12, { crankRadius: 8.4 }) });
    expect(result.status).toBe("FAIL");
    expect(result.crank!.radiusMm).toBeCloseTo(8.4, 2);
    expect(result.failures.some(failure => failure.includes("traces a circle of 8.4"))).toBe(true);
  });

  test("a rod that changes length between poses fails rigidity", () => {
    const result = measureSliderCrankMotion({
      contract,
      poses: poses(12, { stretchMm: radians => 0.4 * Math.sin(3 * radians) }),
    });
    expect(result.status).toBe("FAIL");
    expect(result.rodLengthMm!.spread).toBeGreaterThan(0.05);
    expect(result.failures.some(failure => failure.includes("cannot stretch"))).toBe(true);
  });

  test("a piston off its analytic position fails closure", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses(12, { phaseMm: 1.5 }) });
    expect(result.status).toBe("FAIL");
    expect(result.failures.some(failure => failure.includes("differ from the analytic slider-crank"))).toBe(true);
    expect(result.poses.some(pose => pose.maxErrorMm! > 1)).toBe(true);
  });

  test("a pin whose axis is not +Y is refused, not passed", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses(12, { pinAxis: "x" }) });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("crank pin");
    expect(result.poses[0].contours.crank).toBe(0);
  });

  test("tilted pins are caught by the second slice", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses(12, { pinAxis: "tilt" }) });
    expect(result.status).toBe("FAIL");
    expect(result.axisDriftMm).toBeGreaterThan(0.05);
    expect(result.failures.some(failure => failure.includes("parallel slices"))).toBe(true);
    // The closure check still passes: only the out-of-plane evidence changed.
    expect(result.poses.every(pose => pose.maxErrorMm! < 0.05)).toBe(true);
  });

  test("one pose cannot separate motion from a static assembly", () => {
    const result = measureSliderCrankMotion({ contract, poses: poses(1) });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("Three non-collinear poses");
    expect(result.crank).toBeNull();
  });

  test("collinear poses define no crank circle", () => {
    const result = measureSliderCrankMotion({ contract, poses: [poseAt(0), poseAt(180), poseAt(360)] });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("collinear");
  });

  test("a rod with one bore is a measurement error, not a pass", () => {
    const broken = poses(12);
    for (const pose of broken) {
      // One bore only: the rod cannot define a length.
      pose.meshes.rod = yTubeStl({ outerRadius: 4, innerRadius: 2.2, y0: 1, y1: 4, x: 0, z: 0 });
    }
    const result = measureSliderCrankMotion({ contract, poses: broken });
    expect(result.status).toBe("ERROR");
    expect(result.reason).toContain("rod bore");
  });

  test("invalid contracts and duplicate angles are refused", () => {
    expect(() => measureSliderCrankMotion({ contract: { ...contract, toleranceMm: -1 }, poses: poses() })).toThrow();
    expect(() => measureSliderCrankMotion({ contract, poses: [poseAt(0), poseAt(0)] })).toThrow();
    expect(() => measureSliderCrankMotion({ contract, poses: [] })).toThrow();
    for (const axisProbeMm of [0, NaN, Infinity]) {
      expect(() => measureSliderCrankMotion({ contract: { ...contract, axisProbeMm }, poses: poses() })).toThrow();
    }
  });

  test("uneven angular coverage is not reported as uniform sampling", () => {
    const result = measureSliderCrankMotion({ contract, poses: [poseAt(0), poseAt(30), poseAt(180)] });
    expect(result.coverage.stepDeg).toBeNull();
    expect(result.coverage.anglesDegrees).toEqual([0, 30, 180]);
  });

  test("without an axis probe the report says the axis was not measured", () => {
    const result = measureSliderCrankMotion({ contract: { ...contract, axisProbeMm: undefined }, poses: poses() });
    expect(result.status).toBe("PASS");
    expect(result.reason).toContain("parallelism was not measured");
    expect(result.axisCheck.performed).toBe(false);
    expect(result.axisCheck.reason).toContain("not measured");
    expect(result.axisDriftMm).toBeNull();
    expect(result.coverage.slicesPerPose).toBe(1);
  });
});
