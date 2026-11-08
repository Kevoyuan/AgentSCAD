import { buildBvh, transformPoint, type Bvh } from "./mesh-collision";
import { cross, dot, normalize, readBinaryStl, subtract, type TriangleMesh, type Vec3 } from "./stl-mesh";
import { validateRigidTransform } from "../assembly/assembly-spec";
import { createHash } from "node:crypto";

type Polygon = Vec3[];
type Triangle = [Vec3, Vec3, Vec3];

function triangle(mesh: TriangleMesh, index: number): Triangle {
  const offset = index * 9;
  return [0, 3, 6].map(start => Array.from(mesh.coordinates.slice(offset + start, offset + start + 3))) as Triangle;
}

function distanceToTriangle(point: Vec3, vertices: Triangle): number {
  const [a, b, c] = vertices;
  const normal = normalize(cross(subtract(b, a), subtract(c, a)));
  const planeDistance = dot(subtract(point, a), normal);
  const projected = point.map((value, k) => value - planeDistance * normal[k]) as Vec3;
  const inside = vertices.every((vertex, k) =>
    dot(cross(subtract(vertices[(k + 1) % 3], vertex), subtract(projected, vertex)), normal) >= 0);
  if (inside) return Math.abs(planeDistance);
  return Math.min(...vertices.map((vertex, k) => {
    const edge = subtract(vertices[(k + 1) % 3], vertex);
    const fraction = Math.max(0, Math.min(1, dot(subtract(point, vertex), edge) / dot(edge, edge)));
    return Math.hypot(...point.map((value, axis) => value - vertex[axis] - fraction * edge[axis]));
  }));
}

/** Splits preserve both closed half-polygons. No residual area is discarded. */
function splitPolygon(polygon: Polygon, origin: Vec3, inward: Vec3, margin: number) {
  const inside: Polygon = [], outside: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = dot(subtract(a, origin), inward) + margin;
    const db = dot(subtract(b, origin), inward) + margin;
    if (da >= 0) inside.push(a);
    if (da <= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const fraction = da / (da - db);
      const point = a.map((value, k) => value + fraction * (b[k] - value)) as Vec3;
      inside.push(point);
      outside.push(point);
    }
  }
  return { inside, outside };
}

/**
 * Each removed convex fragment has all vertices within tolerance of ONE target
 * triangle. Distance to that convex triangle is convex, so the bound covers the
 * whole fragment. Target projection only selects fragments; it never proves
 * distance. Running both directions bounds the unoriented surface distance.
 * This is double precision geometry, without interval-arithmetic certification.
 */
export function compareSurfaceCover(input: {
  local: Buffer;
  posed: Buffer;
  transform: number[];
  toleranceMm?: number;
  maxClipTests?: number;
}) {
  const tolerance = input.toleranceMm ?? 1e-4;
  const limit = input.maxClipTests ?? 200_000;
  if (!validateRigidTransform(input.transform).success || !Number.isFinite(tolerance)
    || tolerance < 1e-6 || tolerance > 0.1 || !Number.isInteger(limit) || limit < 1 || limit > 1_000_000)
    throw new Error("Invalid surface cover protocol");
  const local = readBinaryStl(input.local), posed = readBinaryStl(input.posed);
  const base = {
    method: "bidirectional-convex-triangle-cover/v1", toleranceMm: tolerance,
    localSha256: createHash("sha256").update(input.local).digest("hex"),
    posedSha256: createHash("sha256").update(input.posed).digest("hex"),
    transform: [...input.transform], maxClipTests: limit,
    coverage: "Double precision convex-fragment distance bounds in both directions at one pose. Unoriented surface sets only, without multiplicity, topology, solid validity, semantic identity, continuous motion or physical qualification. Arithmetic guard is a numerical margin, not an interval-arithmetic proof."
  };
  let clipTests = 0, nodeTests = 0, vertexTests = 0, maxCertifiedFragmentDistanceMm = 0;
  const unavailable = (reason: string) => ({ ...base, status: "NOT_RUN" as const, reason, clipTests, nodeTests, vertexTests, maxCertifiedFragmentDistanceMm });
  if (local.triangleCount > 5000 || posed.triangleCount > 5000) return unavailable("Triangle budget exceeded");
  const coordinates = new Float64Array(local.coordinates.length);
  for (let i = 0; i < local.coordinates.length; i += 3) {
    coordinates.set(transformPoint(input.transform, Array.from(local.coordinates.slice(i, i + 3)) as Vec3), i);
  }
  const placed = { ...local, coordinates };
  let coordinateScale = 1;
  for (const mesh of [placed, posed]) for (const value of mesh.coordinates) coordinateScale = Math.max(coordinateScale, Math.abs(value));
  const arithmeticGuardMm = coordinateScale * 1e-9;
  if (arithmeticGuardMm > tolerance / 100) return unavailable("Coordinate scale exceeds guarded numerical range");
  const a = buildBvh(placed), b = buildBvh(posed);
  if (a.degenerateTriangles || b.degenerateTriangles) return unavailable("Degenerate triangles need separate treatment");

  const cover = (source: TriangleMesh, target: Bvh): string | undefined => {
    for (let index = 0; index < source.triangleCount; index++) {
      const vertices = triangle(source, index);
      const normal = normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
      const bounds = [0, 1, 2].map(k => Math.min(...vertices.map(vertex => vertex[k])) - tolerance)
        .concat([0, 1, 2].map(k => Math.max(...vertices.map(vertex => vertex[k])) + tolerance));
      let pending: Polygon[] = [vertices];
      const nodes = [0];
      while (nodes.length && pending.length) {
        if (++nodeTests > 2_000_000) return "BVH traversal budget exceeded";
        const node = nodes.pop()!;
        const offset = node * 6;
        if ([0, 1, 2].some(k => bounds[k] > target.bounds[offset + k + 3] || bounds[k + 3] < target.bounds[offset + k])) continue;
        if (!target.count[node]) {
          nodes.push(target.start[node], target.right[node]);
          continue;
        }
        for (let i = 0; i < target.count[node] && pending.length; i++) {
          const candidate = triangle(target.mesh, target.order[target.start[node] + i]);
          const projectedArea = dot(cross(subtract(candidate[1], candidate[0]), subtract(candidate[2], candidate[0])), normal);
          if (Math.abs(projectedArea) < 1e-12) continue;
          if (projectedArea < 0) [candidate[1], candidate[2]] = [candidate[2], candidate[1]];
          const next: Polygon[] = [];
          for (const polygon of pending) {
            if (++clipTests > limit) return "Convex fragment budget exceeded";
            let inner = polygon;
            const remaining: Polygon[] = [];
            for (let edge = 0; edge < 3 && inner.length; edge++) {
              vertexTests += inner.length;
              if (vertexTests > 5_000_000) return "Clipping vertex budget exceeded";
              const origin = candidate[edge];
              const inward = normalize(cross(normal, subtract(candidate[(edge + 1) % 3], origin)));
              const split = splitPolygon(inner, origin, inward, tolerance / 4);
              if (split.outside.length) remaining.push(split.outside);
              inner = split.inside;
            }
            const bound = inner.length ? Math.max(...inner.map(point => distanceToTriangle(point, candidate))) + arithmeticGuardMm : Infinity;
            if (bound <= tolerance) {
              maxCertifiedFragmentDistanceMm = Math.max(maxCertifiedFragmentDistanceMm, bound);
              next.push(...remaining);
            } else next.push(polygon);
          }
          pending = next;
          if (pending.length > 4096) return "Uncovered fragment count exceeded";
        }
      }
      if (pending.length) return `Triangle ${index} has uncertified surface fragments`;
    }
  };
  const forward = cover(placed, b);
  if (forward) return { ...unavailable(forward), arithmeticGuardMm, direction: "local-to-posed" };
  const reverse = cover(posed, a);
  if (reverse) return { ...unavailable(reverse), arithmeticGuardMm, direction: "posed-to-local" };
  return { ...base, status: "PASS" as const, reason: "Every surface triangle is covered by distance-bounded convex fragments in both directions",
    clipTests, nodeTests, vertexTests, maxCertifiedFragmentDistanceMm, arithmeticGuardMm };
}
