import type { Vec3 } from "../geometry/stl-mesh";

/**
 * Bounded, bidirectional planar triangle *coverage* comparison.
 *
 * Unlike centroid/vertex sampling, each source triangle must be covered in
 * AREA by coplanar target triangles, and vice versa. Exact subdivision of a
 * planar face is therefore not a reason to fail, while missing patches,
 * duplicate patches and extra interior geometry cannot silently PASS.
 *
 * This compares tessellated surfaces within an explicit positional tolerance,
 * NOT the enclosed solid, topology, feature semantics or continuous motion.
 */
type Triangle = [Vec3, Vec3, Vec3];
type P2 = [number, number];
type Face = {
  vertices: Triangle;
  normal: Vec3;
  bounds: [number, number, number, number, number, number];
  areaMm2: number;
  perimeterMm: number;
  projection: 0 | 1 | 2;
};

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const distance = (a: Vec3, b: Vec3) => length(subtract(a, b));

function toFaces(triangles: Vec3[][]): Face[] | null {
  const faces: Face[] = [];
  for (const vertices of triangles) {
    if (vertices.length !== 3 || vertices.some(point => point.length !== 3 || point.some(value => !Number.isFinite(value)))) return null;
    const [a, b, c] = vertices as Triangle;
    const n = cross(subtract(b, a), subtract(c, a));
    const twiceArea = length(n);
    // Small/degenerate faces are not silently ignored: a missing tiny feature
    // must not be certified merely because it was excluded from the sum.
    if (!(twiceArea > 1e-12) || !Number.isFinite(twiceArea)) return null;
    const normal: Vec3 = [n[0] / twiceArea, n[1] / twiceArea, n[2] / twiceArea];
    const axis: 0 | 1 | 2 = Math.abs(normal[0]) >= Math.abs(normal[1]) && Math.abs(normal[0]) >= Math.abs(normal[2])
      ? 0 : Math.abs(normal[1]) >= Math.abs(normal[2]) ? 1 : 2;
    const perimeterMm = distance(a, b) + distance(b, c) + distance(c, a);
    const bounds: Face["bounds"] = [
      Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2]),
      Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2]),
    ];
    faces.push({ vertices: [a, b, c], normal, areaMm2: twiceArea / 2, perimeterMm, bounds, projection: axis });
  }
  return faces;
}

function planeCompatible(a: Face, b: Face, toleranceMm: number): boolean {
  // Normal alone is not enough: distinct near-parallel planes must never
  // overlap as geometry just because their 2D projections coincide.
  if (Math.abs(dot(a.normal, b.normal)) < 0.99999) return false;
  const nearPlane = (vertices: Triangle, face: Face) =>
    vertices.every(vertex => Math.abs(dot(subtract(vertex, face.vertices[0]), face.normal)) <= toleranceMm);
  return nearPlane(a.vertices, b) && nearPlane(b.vertices, a);
}
function project(point: Vec3, axis: 0 | 1 | 2): P2 {
  return axis === 0 ? [point[1], point[2]] : axis === 1 ? [point[0], point[2]] : [point[0], point[1]];
}
function signedDoubleArea(poly: P2[]): number {
  let result = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    result += a[0] * b[1] - a[1] * b[0];
  }
  return result;
}
function edgeSide(a: P2, b: P2, p: P2): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

/** Exact convex triangle clipping in a common 2D projection. */
function projectedOverlapArea(a: Face, b: Face): number {
  const axis = a.projection;
  const polygon = a.vertices.map(vertex => project(vertex, axis));
  const clipper = b.vertices.map(vertex => project(vertex, axis));
  const sign = Math.sign(signedDoubleArea(clipper));
  if (!sign) return 0;
  let clipped: P2[] = polygon;
  for (let i = 0; i < 3; i++) {
    const start = clipper[i], end = clipper[(i + 1) % 3];
    const input = clipped;
    clipped = [];
    if (input.length === 0) break;
    for (let j = 0; j < input.length; j++) {
      const current = input[j], next = input[(j + 1) % input.length];
      const curSide = sign * edgeSide(start, end, current);
      const nextSide = sign * edgeSide(start, end, next);
      const curInside = curSide >= 0, nextInside = nextSide >= 0;
      if (curInside) clipped.push(current);
      if (curInside !== nextInside) {
        const denominator = curSide - nextSide;
        if (denominator !== 0) {
          const t = curSide / denominator;
          clipped.push([current[0] + t * (next[0] - current[0]), current[1] + t * (next[1] - current[1])]);
        }
      }
    }
  }
  if (clipped.length < 3) return 0;
  return Math.abs(signedDoubleArea(clipped)) / (2 * Math.abs(a.normal[axis]));
}

type DirectionResult = {
  status: "PASS" | "NOT_RUN";
  reason: string;
  testedPairs: number;
  comparedTriangles: number;
  maximumAreaMismatchMm2: number;
  maximumAreaBudgetMm2: number;
  firstUndecidedTriangle?: number;
};
function coverDirection(source: Face[], target: Face[], toleranceMm: number, remainingPairs: number): DirectionResult {
  const sorted = [...target].sort((a, b) => a.bounds[0] - b.bounds[0]);
  let testedPairs = 0;
  let maximumAreaMismatchMm2 = 0;
  let maximumAreaBudgetMm2 = 0;
  const observed = (status: "PASS" | "NOT_RUN", reason: string, comparedTriangles: number, index?: number): DirectionResult => ({
    status, reason, testedPairs, comparedTriangles, maximumAreaMismatchMm2, maximumAreaBudgetMm2,
    ...(index === undefined ? {} : { firstUndecidedTriangle: index }),
  });
  for (let i = 0; i < source.length; i++) {
    const a = source[i];
    // This budget controls floating projection/clipping error. It is NOT
    // an experimentally calibrated shape uncertainty or printer tolerance.
    const areaBudget = toleranceMm * a.perimeterMm * 3 + 8 * toleranceMm * toleranceMm;
    maximumAreaBudgetMm2 = Math.max(maximumAreaBudgetMm2, areaBudget);
    if (a.areaMm2 <= areaBudget * 2) {
      return observed("NOT_RUN", "A tiny facet is below the planar coverage resolution; no confident area equivalence.", i, i);
    }
    let areaCovered = 0;
    for (const b of sorted) {
      if (b.bounds[0] > a.bounds[3] + toleranceMm) break;
      // Count EVERY X-range broadphase candidate, including other-axis
      // rejections. Otherwise many disjoint triangles in the same X slab
      // could consume unbounded CPU without spending the declared budget.
      if (++testedPairs > remainingPairs) return observed("NOT_RUN", "Planar surface comparison pair budget exceeded.", i, i);
      if (b.bounds[3] < a.bounds[0] - toleranceMm ||
        b.bounds[1] > a.bounds[4] + toleranceMm || b.bounds[4] < a.bounds[1] - toleranceMm ||
        b.bounds[2] > a.bounds[5] + toleranceMm || b.bounds[5] < a.bounds[2] - toleranceMm) continue;
      if (!planeCompatible(a, b, toleranceMm)) continue;
      const overlap = projectedOverlapArea(a, b);
      if (!Number.isFinite(overlap)) return observed("NOT_RUN", "Non-finite planar overlap area.", i, i);
      areaCovered += overlap;
    }
    const areaMismatch = Math.abs(a.areaMm2 - areaCovered);
    maximumAreaMismatchMm2 = Math.max(maximumAreaMismatchMm2, areaMismatch);
    if (areaMismatch > areaBudget) {
      return observed("NOT_RUN", "A facet has unproven surface coverage or excess overlapping geometry.", i + 1, i);
    }
  }
  return observed("PASS", "Every planar facet is covered by coplanar counterparts within explicit area tolerances.", source.length);
}

export type PlanarSurfaceCoverage = {
  method: "bidirectional-coplanar-triangle-area/v1";
  status: "PASS" | "NOT_RUN";
  reason: string;
  testedPairs: number;
  trianglesChecked: number;
  maximumAreaMismatchMm2: number;
  maximumAreaBudgetMm2: number;
  toleranceMm: number;
  coverage: string;
};

export function comparePlanarSurfaceCoverage(
  leftTriangles: Vec3[][],
  rightTriangles: Vec3[][],
  toleranceMm: number,
  maxPairTests = 2_000_000,
): PlanarSurfaceCoverage {
  if (!(toleranceMm >= 1e-6 && toleranceMm <= 0.1) || !Number.isSafeInteger(maxPairTests) ||
    maxPairTests < 1 || maxPairTests > 2_000_000) throw new Error("Invalid planar coverage tolerance/budget");
  const base = {
    method: "bidirectional-coplanar-triangle-area/v1" as const,
    toleranceMm,
    coverage: "Both directions; plane distances, projected triangle intersection areas and numerical area bounds at ONE sampled pose. No volume/solid topology, continuous sweep, intended feature binding, experimental calibration, physical fit or manufacturing proof.",
  };
  if (leftTriangles.length === 0 || rightTriangles.length === 0 ||
    leftTriangles.length > 50_000 || rightTriangles.length > 50_000) {
    return { ...base, status: "NOT_RUN", reason: "Missing triangles or triangle budget exceeded.", testedPairs: 0,
      trianglesChecked: 0, maximumAreaMismatchMm2: 0, maximumAreaBudgetMm2: 0 };
  }
  const left = toFaces(leftTriangles), right = toFaces(rightTriangles);
  if (!left || !right) {
    return { ...base, status: "NOT_RUN", reason: "Degenerate or nonfinite triangle prevents sound surface comparison.",
      testedPairs: 0, trianglesChecked: 0, maximumAreaMismatchMm2: 0, maximumAreaBudgetMm2: 0 };
  }
  const forward = coverDirection(left, right, toleranceMm, maxPairTests);
  if (forward.status !== "PASS") return {
    ...base, status: "NOT_RUN", reason: "Forward comparison: " + forward.reason,
    testedPairs: forward.testedPairs, trianglesChecked: forward.comparedTriangles,
    maximumAreaMismatchMm2: forward.maximumAreaMismatchMm2, maximumAreaBudgetMm2: forward.maximumAreaBudgetMm2,
  };
  const backward = coverDirection(right, left, toleranceMm, maxPairTests - forward.testedPairs);
  return {
    ...base, status: backward.status,
    reason: backward.status === "PASS" ? "Each triangulated surface covers the other within finite per-facet plane and area bounds." :
      "Reverse comparison: " + backward.reason,
    testedPairs: forward.testedPairs + backward.testedPairs,
    trianglesChecked: forward.comparedTriangles + backward.comparedTriangles,
    maximumAreaMismatchMm2: Math.max(forward.maximumAreaMismatchMm2, backward.maximumAreaMismatchMm2),
    maximumAreaBudgetMm2: Math.max(forward.maximumAreaBudgetMm2, backward.maximumAreaBudgetMm2),
  };
}
