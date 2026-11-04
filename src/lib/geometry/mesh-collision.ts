/**
 * Triangle-level collision between two tessellated meshes.
 *
 * Everything here is original and deliberately conservative:
 *
 * - A bounding-box overlap is never reported as a collision. The BVH only
 *   prunes; a verdict requires an actual triangle pair to intersect.
 * - "Separated" is only returned when every overlapping node pair was examined.
 *   If a traversal budget runs out first, the answer is `UNKNOWN`, because a
 *   budget is not evidence.
 * - Touching surfaces count as intersecting. The test cannot distinguish
 *   "resting in contact" from "penetrating by a micron", so a caller that wants
 *   contact tolerance has to declare it rather than have it silently assumed.
 *
 * The BVH is built once per mesh in local coordinates. A pose only transforms
 * the node bounds (conservatively: the box of the transformed box) and the
 * triangle vertices of the few candidate pairs, so sampling many poses does not
 * rebuild the tree.
 */
import type { TriangleMesh, Vec3 } from "./stl-mesh";

/** Row-major 4x4; translation lives in entries 3, 7 and 11. */
export type Mat4 = number[] | Float64Array;

const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const DEFAULT_LEAF_SIZE = 8;
const DEFAULT_EPSILON_MM = 1e-6;
/** Deterministic upper bound: sampling must not hang on a pathological input. */
const DEFAULT_MAX_PAIR_TESTS = 200_000;

export interface Bvh {
  mesh: TriangleMesh;
  /** Six values per node: minX, minY, minZ, maxX, maxY, maxZ. */
  bounds: Float64Array;
  /** Leaf: first index into `order`. Interior: left child index. */
  start: Int32Array;
  /** Leaf: triangle count (> 0). Interior: 0. */
  count: Int32Array;
  /** Interior: right child index. Leaf: -1. */
  right: Int32Array;
  /** Triangle indices grouped by leaf. */
  order: Int32Array;
  nodeCount: number;
  /** Triangles whose area is zero; they are never treated as colliding surfaces. */
  degenerateTriangles: number;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function triangleBounds(coordinates: Float64Array, triangle: number, out: number[], offset: number) {
  const base = triangle * 9;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < 3; v++) {
    const x = coordinates[base + v * 3], y = coordinates[base + v * 3 + 1], z = coordinates[base + v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  out[offset] = minX; out[offset + 1] = minY; out[offset + 2] = minZ;
  out[offset + 3] = maxX; out[offset + 4] = maxY; out[offset + 5] = maxZ;
}

function isDegenerate(coordinates: Float64Array, triangle: number): boolean {
  const base = triangle * 9;
  const ax = coordinates[base], ay = coordinates[base + 1], az = coordinates[base + 2];
  const ux = coordinates[base + 3] - ax, uy = coordinates[base + 4] - ay, uz = coordinates[base + 5] - az;
  const vx = coordinates[base + 6] - ax, vy = coordinates[base + 7] - ay, vz = coordinates[base + 8] - az;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.hypot(cx, cy, cz) <= 1e-12;
}

/**
 * Median-split BVH over triangle centroids. Splits on the longest axis of the
 * node bounds, ties broken by triangle index, so the same mesh always yields the
 * same tree.
 */
export function buildBvh(mesh: TriangleMesh, leafSize = DEFAULT_LEAF_SIZE): Bvh {
  if (!Number.isInteger(mesh.triangleCount) || mesh.triangleCount < 0) throw new Error("Invalid triangle count");
  if (mesh.coordinates.length !== mesh.triangleCount * 9) throw new Error("Triangle table does not match its count");
  const size = Math.max(1, Math.trunc(leafSize));
  const count = mesh.triangleCount;
  const triangleBoxes = new Float64Array(count * 6);
  const centroids = new Float64Array(count * 3);
  let degenerateTriangles = 0;
  const scratch = new Array<number>(6);
  for (let i = 0; i < count; i++) {
    triangleBounds(mesh.coordinates, i, scratch, 0);
    triangleBoxes.set(scratch, i * 6);
    centroids[i * 3] = (scratch[0] + scratch[3]) / 2;
    centroids[i * 3 + 1] = (scratch[1] + scratch[4]) / 2;
    centroids[i * 3 + 2] = (scratch[2] + scratch[5]) / 2;
    if (isDegenerate(mesh.coordinates, i)) degenerateTriangles++;
  }

  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;

  const bounds: number[] = [];
  const starts: number[] = [];
  const counts: number[] = [];
  const rights: number[] = [];

  const nodeBounds = (from: number, to: number): number[] => {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = from; i < to; i++) {
      const t = order[i] * 6;
      if (triangleBoxes[t] < minX) minX = triangleBoxes[t];
      if (triangleBoxes[t + 1] < minY) minY = triangleBoxes[t + 1];
      if (triangleBoxes[t + 2] < minZ) minZ = triangleBoxes[t + 2];
      if (triangleBoxes[t + 3] > maxX) maxX = triangleBoxes[t + 3];
      if (triangleBoxes[t + 4] > maxY) maxY = triangleBoxes[t + 4];
      if (triangleBoxes[t + 5] > maxZ) maxZ = triangleBoxes[t + 5];
    }
    return [minX, minY, minZ, maxX, maxY, maxZ];
  };

  const build = (from: number, to: number): number => {
    const box = nodeBounds(from, to);
    const index = starts.length;
    starts.push(from);
    counts.push(0);
    rights.push(-1);
    bounds.push(...box);
    if (to - from <= size) {
      counts[index] = to - from;
      return index;
    }
    const extents = [box[3] - box[0], box[4] - box[1], box[5] - box[2]];
    const axis = extents[0] >= extents[1] && extents[0] >= extents[2] ? 0 : extents[1] >= extents[2] ? 1 : 2;
    const slice = Array.from(order.subarray(from, to));
    slice.sort((left, right) => {
      const delta = centroids[left * 3 + axis] - centroids[right * 3 + axis];
      return delta !== 0 ? delta : left - right;
    });
    order.set(slice, from);
    const mid = (from + to) >>> 1;
    const left = build(from, mid);
    const right = build(mid, to);
    starts[index] = left;
    rights[index] = right;
    return index;
  };

  if (count > 0) build(0, count);
  else {
    starts.push(0); counts.push(0); rights.push(-1);
    bounds.push(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
  }

  return {
    mesh,
    bounds: Float64Array.from(bounds),
    start: Int32Array.from(starts),
    count: Int32Array.from(counts),
    right: Int32Array.from(rights),
    order,
    nodeCount: starts.length,
    degenerateTriangles,
  };
}

export interface PlacedBvh {
  bvh: Bvh;
  matrix: Mat4;
  /** Node bounds transformed into the query space; conservative, never tighter. */
  worldBounds: Float64Array;
}

/** Transforms node bounds only. The box of a transformed box is a superset of the transformed geometry. */
export function placeBvh(bvh: Bvh, matrix: Mat4 = IDENTITY): PlacedBvh {
  if (matrix.length !== 16 || Array.from(matrix).some((value) => !Number.isFinite(value))) throw new Error("A finite 4x4 matrix is required");
  const worldBounds = new Float64Array(bvh.nodeCount * 6);
  for (let node = 0; node < bvh.nodeCount; node++) {
    const o = node * 6;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const x = (corner & 1) ? bvh.bounds[o + 3] : bvh.bounds[o];
      const y = (corner & 2) ? bvh.bounds[o + 4] : bvh.bounds[o + 1];
      const z = (corner & 4) ? bvh.bounds[o + 5] : bvh.bounds[o + 2];
      const px = matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3];
      const py = matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7];
      const pz = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11];
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    worldBounds[o] = minX; worldBounds[o + 1] = minY; worldBounds[o + 2] = minZ;
    worldBounds[o + 3] = maxX; worldBounds[o + 4] = maxY; worldBounds[o + 5] = maxZ;
  }
  return { bvh, matrix, worldBounds };
}

function boxesOverlap(a: Float64Array, ai: number, b: Float64Array, bi: number, epsilon: number): boolean {
  return a[ai] <= b[bi + 3] + epsilon && b[bi] <= a[ai + 3] + epsilon
    && a[ai + 1] <= b[bi + 4] + epsilon && b[bi + 1] <= a[ai + 4] + epsilon
    && a[ai + 2] <= b[bi + 5] + epsilon && b[bi + 2] <= a[ai + 5] + epsilon;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function unitNormal(p0: Vec3, p1: Vec3, p2: Vec3): Vec3 | null {
  const n = cross3(sub(p1, p0), sub(p2, p0));
  const length = Math.hypot(n[0], n[1], n[2]);
  if (!(length > 1e-12)) return null;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/**
 * Coplanar case: separating-axis test on the six edge normals. Exact for two
 * triangles, which are convex.
 */
function coplanarTrianglesOverlap(a: Vec3[], b: Vec3[], normal: Vec3, epsilon: number): boolean {
  // Drop the dominant axis so the projection keeps the most area.
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const project = (p: Vec3): [number, number] => drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[0], p[2]] : [p[0], p[1]];
  const pa = a.map(project), pb = b.map(project);
  const edges: Array<[[number, number], [number, number]]> = [];
  for (const polygon of [pa, pb]) {
    for (let i = 0; i < 3; i++) edges.push([polygon[i], polygon[(i + 1) % 3]]);
  }
  for (const [p, q] of edges) {
    const nx = -(q[1] - p[1]), ny = q[0] - p[0];
    const length = Math.hypot(nx, ny);
    if (!(length > 1e-12)) continue;
    const ux = nx / length, uy = ny / length;
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const point of pa) { const value = point[0] * ux + point[1] * uy; if (value < minA) minA = value; if (value > maxA) maxA = value; }
    for (const point of pb) { const value = point[0] * ux + point[1] * uy; if (value < minB) minB = value; if (value > maxB) maxB = value; }
    if (maxA < minB - epsilon || maxB < minA - epsilon) return false;
  }
  return true;
}

/**
 * Triangle-triangle intersection after the interval-overlap formulation: each
 * triangle is cut by the other's plane and the two cut segments must overlap on
 * the planes' intersection line.
 */
export function trianglesIntersect(a0: Vec3, a1: Vec3, a2: Vec3, b0: Vec3, b1: Vec3, b2: Vec3, epsilon = DEFAULT_EPSILON_MM): boolean {
  const normalB = unitNormal(b0, b1, b2);
  const normalA = unitNormal(a0, a1, a2);
  if (!normalA || !normalB) return false;

  const da = [dot3(normalB, a0) - dot3(normalB, b0), dot3(normalB, a1) - dot3(normalB, b0), dot3(normalB, a2) - dot3(normalB, b0)];
  if ((da[0] > epsilon && da[1] > epsilon && da[2] > epsilon) || (da[0] < -epsilon && da[1] < -epsilon && da[2] < -epsilon)) return false;
  const db = [dot3(normalA, b0) - dot3(normalA, a0), dot3(normalA, b1) - dot3(normalA, a0), dot3(normalA, b2) - dot3(normalA, a0)];
  if ((db[0] > epsilon && db[1] > epsilon && db[2] > epsilon) || (db[0] < -epsilon && db[1] < -epsilon && db[2] < -epsilon)) return false;

  const aOnPlane = da.every((value) => Math.abs(value) <= epsilon);
  const bOnPlane = db.every((value) => Math.abs(value) <= epsilon);
  if (aOnPlane || bOnPlane) return coplanarTrianglesOverlap([a0, a1, a2], [b0, b1, b2], normalB, epsilon);

  const direction = cross3(normalA, normalB);
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  // Parallel planes that are not coplanar cannot meet; the sign tests above
  // already ruled out a straddling triangle.
  if (!(length > 1e-12)) return false;
  const axis: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];

  const interval = (points: Vec3[], distances: number[]): [number, number] | null => {
    const crossings: Vec3[] = [];
    const push = (point: Vec3) => {
      if (crossings.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2]) <= epsilon)) return;
      crossings.push(point);
    };
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (Math.abs(distances[i]) <= epsilon) push(points[i]);
      const product = distances[i] * distances[j];
      if (product < 0) {
        const t = distances[i] / (distances[i] - distances[j]);
        push([
          points[i][0] + t * (points[j][0] - points[i][0]),
          points[i][1] + t * (points[j][1] - points[i][1]),
          points[i][2] + t * (points[j][2] - points[i][2]),
        ]);
      }
    }
    if (crossings.length === 0) return null;
    let min = Infinity, max = -Infinity;
    for (const point of crossings) {
      const value = dot3(point, axis);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return [min, max];
  };

  const intervalA = interval([a0, a1, a2], da);
  const intervalB = interval([b0, b1, b2], db);
  if (!intervalA || !intervalB) return false;
  return Math.max(intervalA[0], intervalB[0]) <= Math.min(intervalA[1], intervalB[1]) + epsilon;
}

export type CollisionStatus = "INTERSECT" | "CONTAINED" | "SEPARATED" | "UNKNOWN";

export interface CollisionResult {
  status: CollisionStatus;
  /** True when the meshes interfere. `UNKNOWN` is never treated as clear. */
  blocked: boolean;
  /** First intersecting triangle pair, for diagnosis. Indices are into each mesh. */
  pair: { a: number; b: number } | null;
  /** A point inside the intersection, useful for reporting where it happened. */
  point: Vec3 | null;
  testedPairs: number;
  /** True when the traversal budget ran out before the question was answered. */
  budgetExhausted: boolean;
  /** Zero-area triangles are skipped; their presence is reported, not hidden. */
  degenerateTriangles: { a: number; b: number };
  reason: string;
}

/**
 * Möller–Trumbore. Returns the ray parameter, or null when the ray misses.
 * `t <= 0` is a miss so a point on the surface is not counted as a crossing.
 */
function rayTriangleDistance(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a), e2 = sub(c, a);
  const pvec = cross3(direction, e2);
  const determinant = dot3(e1, pvec);
  if (Math.abs(determinant) < 1e-12) return null;
  const inverse = 1 / determinant;
  const tvec = sub(origin, a);
  const u = dot3(tvec, pvec) * inverse;
  if (u < 0 || u > 1) return null;
  const qvec = cross3(tvec, e1);
  const v = dot3(direction, qvec) * inverse;
  if (v < 0 || u + v > 1) return null;
  const t = dot3(e2, qvec) * inverse;
  return t > 1e-9 ? t : null;
}

/** Slab test; a ray starting inside counts as hitting. */
function rayHitsBox(origin: Vec3, direction: Vec3, bounds: Float64Array, offset: number): boolean {
  let near = -Infinity, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const originValue = origin[axis], directionValue = direction[axis];
    const low = bounds[offset + axis], high = bounds[offset + 3 + axis];
    if (Math.abs(directionValue) < 1e-12) {
      if (originValue < low || originValue > high) return false;
      continue;
    }
    const t1 = (low - originValue) / directionValue;
    const t2 = (high - originValue) / directionValue;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return far > 0;
}

/** Number of times a ray from `point` crosses the surface of `placed`. */
function countRayCrossings(point: Vec3, placed: PlacedBvh, direction: Vec3): number {
  const { bvh, worldBounds, matrix } = placed;
  if (bvh.mesh.triangleCount === 0) return 0;
  let crossings = 0;
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!rayHitsBox(point, direction, worldBounds, node * 6)) continue;
    if (bvh.count[node] === 0) {
      stack.push(bvh.start[node], bvh.right[node]);
      continue;
    }
    const start = bvh.start[node], count = bvh.count[node];
    for (let i = 0; i < count; i++) {
      const triangle = bvh.order[start + i];
      if (isDegenerate(bvh.mesh.coordinates, triangle)) continue;
      const [a, b, c] = readTriangle(bvh.mesh.coordinates, triangle, matrix);
      if (rayTriangleDistance(point, direction, a, b, c) !== null) crossings++;
    }
  }
  return crossings;
}

/**
 * Deliberately non-axis-aligned directions with no shared coordinate ratios, so
 * a ray is unlikely to graze a mesh edge. A single direction can still graze
 * one, so a disagreement is reported as ambiguous rather than resolved by
 * picking a winner.
 */
const PROBE_DIRECTIONS: Vec3[] = [
  [0.8541825636, 0.3098710412, 0.4185106621],
  [0.2421875031, 0.8653522471, 0.4387125053],
  [0.5362117721, 0.1974523109, 0.8204913411],
  [0.3314620715, 0.6102834109, 0.7194813027],
  [0.6904132217, 0.7021356043, 0.1739107731],
];

export function classifyPoint(point: Vec3, placed: PlacedBvh): "INSIDE" | "OUTSIDE" | "AMBIGUOUS" {
  const votes: boolean[] = [];
  for (const direction of PROBE_DIRECTIONS) votes.push(countRayCrossings(point, placed, direction) % 2 === 1);
  if (votes.every((vote) => vote)) return "INSIDE";
  if (votes.every((vote) => !vote)) return "OUTSIDE";
  return "AMBIGUOUS";
}

/**
 * Reduces a set of probes to one verdict. A grazing ray is not evidence either
 * way, so ambiguous probes are discarded — but a verdict needs at least two
 * clear probes, and any disagreement between clear probes is reported as such
 * instead of being outvoted.
 */
function reduceProbes(verdicts: Array<"INSIDE" | "OUTSIDE" | "AMBIGUOUS">): "ALL_INSIDE" | "ALL_OUTSIDE" | "MIXED" | "UNCLEAR" {
  const clear = verdicts.filter((verdict) => verdict !== "AMBIGUOUS");
  if (clear.length < 2) return "UNCLEAR";
  if (clear.some((verdict) => verdict === "INSIDE") && clear.some((verdict) => verdict === "OUTSIDE")) return "MIXED";
  return clear.every((verdict) => verdict === "INSIDE") ? "ALL_INSIDE" : "ALL_OUTSIDE";
}

/** A cache of edge-connected closed shells. A multi-shell STL needs probes on
 * every shell: whole-mesh sampling can miss an embedded small component.
 * Exact STL vertex equality is intentional; gaps are not silently welded. */
const closedShellCache = new WeakMap<Bvh, number[][] | null>();
function closedShellSamples(bvh: Bvh): number[][] | null {
  if (closedShellCache.has(bvh)) return closedShellCache.get(bvh)!;
  const count = bvh.mesh.triangleCount;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (initial: number): number => {
    let i = initial;
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const edges = new Map<string, { triangle: number; count: number }>();
  const c = bvh.mesh.coordinates;
  let valid = count > 0 && bvh.degenerateTriangles === 0;
  for (let i = 0; i < count && valid; i++) {
    const vertices = [0, 1, 2].map(v => {
      const j = i * 9 + v * 3;
      return `${c[j]},${c[j + 1]},${c[j + 2]}`;
    });
    for (let v = 0; v < 3; v++) {
      const a = vertices[v], b = vertices[(v + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(key);
      if (!edge) edges.set(key, { triangle: i, count: 1 });
      else {
        edge.count++;
        if (edge.count > 2) { valid = false; break; }
        parent[find(i)] = find(edge.triangle);
      }
    }
  }
  if (valid) valid = [...edges.values()].every(edge => edge.count === 2);
  if (!valid) { closedShellCache.set(bvh, null); return null; }
  const groups = new Map<number, number[]>();
  const shellBounds = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    const bounds = shellBounds.get(root) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const value = c[i * 9 + v * 3 + k];
      bounds[k] = Math.min(bounds[k], value); bounds[k + 3] = Math.max(bounds[k + 3], value);
    }
    shellBounds.set(root, bounds);
    if (group.length < 4 && !group.some(previous => {
      const a = previous * 9, b = i * 9;
      return c[a] === c[b] && c[a + 1] === c[b + 1] && c[a + 2] === c[b + 2];
    })) group.push(i);
    groups.set(root, group);
    if (groups.size > 128) { closedShellCache.set(bvh, null); return null; }
  }
  // Overlapping shell bounds may indicate self-intersecting or nested shells.
  // Parity on the whole mesh cannot tell their intended solid semantics, so
  // do not call their apparent exterior clear without an independent check.
  const boxes = [...shellBounds.values()];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if ([0, 1, 2].every(k => boxes[i][k] <= boxes[j][k + 3] && boxes[j][k] <= boxes[i][k + 3])) {
      closedShellCache.set(bvh, null); return null;
    }
  }
  const result = [...groups.values()];
  closedShellCache.set(bvh, result);
  return result;
}

/** For each closed surface shell, classify vertices against the other mesh.
 * Clear inside evidence blocks; ambiguity cannot establish clearance. This
 * assumes each shell is a valid solid boundary: self-intersection is not tested. */
function classifyContainment(a: PlacedBvh, b: PlacedBvh): { status: CollisionStatus; reason: string; blocked: boolean } {
  const shellsA = closedShellSamples(a.bvh), shellsB = closedShellSamples(b.bvh);
  if (!shellsA || !shellsB) return { status: "UNKNOWN", blocked: true, reason: "A mesh has open or non-manifold edges, overlapping shell bounds, or exceeds the 128-shell budget; containment cannot establish separation." };
  const check = (shells: number[][], source: PlacedBvh, other: PlacedBvh) => shells.map(shell => {
    const coords = source.bvh.mesh.coordinates;
    return reduceProbes(shell.map(i => {
      const n = i * 9;
      return classifyPoint(transformPoint(source.matrix, [coords[n], coords[n + 1], coords[n + 2]]), other);
    }));
  });
  const results = [...check(shellsA, a, b), ...check(shellsB, b, a)];
  if (results.includes("ALL_INSIDE")) return { status: "CONTAINED", blocked: true, reason: "A closed shell lies inside the other mesh: the solids interfere." };
  if (results.some(v => v !== "ALL_OUTSIDE")) return { status: "UNKNOWN", blocked: true, reason: "Containment probes disagree or are inconclusive; separation is not proven." };
  return { status: "SEPARATED", blocked: false, reason: "" };
}


function readTriangle(coordinates: Float64Array, triangle: number, matrix: Mat4): [Vec3, Vec3, Vec3] {
  const base = triangle * 9;
  return [
    transformPoint(matrix, [coordinates[base], coordinates[base + 1], coordinates[base + 2]]),
    transformPoint(matrix, [coordinates[base + 3], coordinates[base + 4], coordinates[base + 5]]),
    transformPoint(matrix, [coordinates[base + 6], coordinates[base + 7], coordinates[base + 8]]),
  ];
}

function centroidOf(triangle: [Vec3, Vec3, Vec3]): Vec3 {
  return [(triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3, (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3, (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3];
}

/**
 * Answers "do these two placed meshes interfere" and says whether the answer is
 * actually known. A BVH overlap alone never counts as a collision, and running
 * out of budget is never reported as clearance.
 */
export function bvhIntersects(a: PlacedBvh, b: PlacedBvh, options: { epsilonMm?: number; maxPairTests?: number } = {}): CollisionResult {
  const epsilon = options.epsilonMm ?? DEFAULT_EPSILON_MM;
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error("epsilonMm must be finite and non-negative");
  const budget = options.maxPairTests ?? DEFAULT_MAX_PAIR_TESTS;
  if (!Number.isFinite(budget) || budget < 1) throw new Error("maxPairTests must be a positive number");
  const base = {
    degenerateTriangles: { a: a.bvh.degenerateTriangles, b: b.bvh.degenerateTriangles },
    testedPairs: 0,
  };
  if (a.bvh.mesh.triangleCount === 0 || b.bvh.mesh.triangleCount === 0) {
    return { ...base, status: "SEPARATED", blocked: false, pair: null, point: null, budgetExhausted: false, reason: "One mesh has no triangles, so there is no surface to collide." };
  }
  if (!boxesOverlap(a.worldBounds, 0, b.worldBounds, 0, epsilon)) {
    // Disjoint bounds also rule out containment, so the expensive probes are skipped.
    return { ...base, status: "SEPARATED", blocked: false, pair: null, point: null, budgetExhausted: false, reason: "The mesh bounds do not overlap." };
  }

  const stack: number[] = [0, 0];
  let testedPairs = 0;
  while (stack.length > 0) {
    const nodeB = stack.pop()!;
    const nodeA = stack.pop()!;
    if (!boxesOverlap(a.worldBounds, nodeA * 6, b.worldBounds, nodeB * 6, epsilon)) continue;
    const leafA = a.bvh.count[nodeA] > 0;
    const leafB = b.bvh.count[nodeB] > 0;
    if (leafA && leafB) {
      const startA = a.bvh.start[nodeA], countA = a.bvh.count[nodeA];
      const startB = b.bvh.start[nodeB], countB = b.bvh.count[nodeB];
      for (let i = 0; i < countA; i++) {
        const triangleA = a.bvh.order[startA + i];
        for (let j = 0; j < countB; j++) {
          const triangleB = b.bvh.order[startB + j];
          testedPairs++;
          if (testedPairs > budget) {
            return { ...base, testedPairs, status: "UNKNOWN", blocked: true, pair: null, point: null, budgetExhausted: true, reason: `Stopped after ${budget} triangle-pair tests without finding an intersection; separation is not proven.` };
          }
          if (isDegenerate(a.bvh.mesh.coordinates, triangleA) || isDegenerate(b.bvh.mesh.coordinates, triangleB)) continue;
          const ta = readTriangle(a.bvh.mesh.coordinates, triangleA, a.matrix);
          const tb = readTriangle(b.bvh.mesh.coordinates, triangleB, b.matrix);
          if (trianglesIntersect(ta[0], ta[1], ta[2], tb[0], tb[1], tb[2], epsilon)) {
            const ca = centroidOf(ta), cb = centroidOf(tb);
            return {
              ...base, testedPairs, status: "INTERSECT", blocked: true, pair: { a: triangleA, b: triangleB },
              point: [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2],
              budgetExhausted: false,
              reason: `Triangles ${triangleA} and ${triangleB} intersect.`,
            };
          }
        }
      }
      continue;
    }
    // Descend the larger node first so the traversal finds near hits sooner.
    const sizeA = leafA ? 0 : (a.worldBounds[nodeA * 6 + 3] - a.worldBounds[nodeA * 6]) + (a.worldBounds[nodeA * 6 + 4] - a.worldBounds[nodeA * 6 + 1]) + (a.worldBounds[nodeA * 6 + 5] - a.worldBounds[nodeA * 6 + 2]);
    const sizeB = leafB ? 0 : (b.worldBounds[nodeB * 6 + 3] - b.worldBounds[nodeB * 6]) + (b.worldBounds[nodeB * 6 + 4] - b.worldBounds[nodeB * 6 + 1]) + (b.worldBounds[nodeB * 6 + 5] - b.worldBounds[nodeB * 6 + 2]);
    if (!leafA && (leafB || sizeA >= sizeB)) {
      stack.push(a.bvh.right[nodeA], nodeB, a.bvh.start[nodeA], nodeB);
    } else {
      stack.push(nodeA, b.bvh.right[nodeB], nodeA, b.bvh.start[nodeB]);
    }
  }
  const containment = classifyContainment(a, b);
  return {
    ...base, testedPairs, status: containment.status, blocked: containment.blocked, pair: null, point: null, budgetExhausted: false,
    reason: containment.status === "SEPARATED"
      ? `Every overlapping node pair was examined (${testedPairs} triangle pairs); no triangles intersect and neither mesh is inside the other.`
      : containment.reason,
  };
}

/** Convenience wrapper: build both trees and answer once. */
export function meshesIntersect(a: TriangleMesh, aMatrix: Mat4, b: TriangleMesh, bMatrix: Mat4, options: { epsilonMm?: number; maxPairTests?: number } = {}): CollisionResult {
  return bvhIntersects(placeBvh(buildBvh(a), aMatrix), placeBvh(buildBvh(b), bMatrix), options);
}
