/**
 * Shared bench-side geometry primitives.
 *
 * These helpers are pure functions over already-rendered triangle meshes. They
 * exist so the v8, product and thread scorers do not each keep their own copy of
 * a ray test, a matrix point transform, a tool cylinder or a cross-section
 * centre. They measure tessellated geometry only; nothing here is a calibrated
 * metrology operation.
 */
import type { TriangleMesh } from "../src/lib/geometry/stl-mesh";

export type Vec3 = [number, number, number];

/** Row-major 4x4 transform of one point. */
export function applyMatrixPoint(matrix: readonly number[], point: readonly [number, number, number]): Vec3 {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

/**
 * Nearest positive ray/triangle distance for a mesh, or null when the ray misses
 * within `maxDistance`. Two-sided: a ray may hit a triangle from either face.
 */
export function nearestTriangleHit(mesh: TriangleMesh, origin: Vec3, direction: Vec3, maxDistance: number): number | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  let best = maxDistance;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const base = triangle * 9;
    const ax = mesh.coordinates[base], ay = mesh.coordinates[base + 1], az = mesh.coordinates[base + 2];
    const bx = mesh.coordinates[base + 3], by = mesh.coordinates[base + 4], bz = mesh.coordinates[base + 5];
    const cx = mesh.coordinates[base + 6], cy = mesh.coordinates[base + 7], cz = mesh.coordinates[base + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const determinant = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(determinant) < 1e-12) continue;
    const inverse = 1 / determinant;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inverse;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
    if (t > 1e-6 && t < best) best = t;
  }
  return best < maxDistance ? best : null;
}

/**
 * A closed cylindrical tool whose flat tip is at `tip` and which extends back
 * along `-direction` for `length`. `direction` need not be unit length; it is
 * normalised here. The mesh is built in world coordinates, so callers test it
 * against identity-transform instance meshes.
 */
export function toolCylinderMesh(tip: Vec3, direction: Vec3, radius: number, length: number, segments = 16): TriangleMesh {
  const lengthOf = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(lengthOf > 0)) throw new Error("tool direction must be non-zero");
  const dx = direction[0] / lengthOf, dy = direction[1] / lengthOf, dz = direction[2] / lengthOf;
  const helper: Vec3 = Math.abs(dx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = dy * helper[2] - dz * helper[1], uy = dz * helper[0] - dx * helper[2], uz = dx * helper[1] - dy * helper[0];
  const ul = Math.hypot(ux, uy, uz);
  const ax = ux / ul, ay = uy / ul, az = uz / ul;
  const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
  const points: number[] = [];
  const ring = (center: Vec3): Vec3[] => Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    const c = Math.cos(angle) * radius, s = Math.sin(angle) * radius;
    return [center[0] + ax * c + bx * s, center[1] + ay * c + by * s, center[2] + az * c + bz * s];
  });
  const front = ring(tip);
  const backCenter: Vec3 = [tip[0] - dx * length, tip[1] - dy * length, tip[2] - dz * length];
  const back = ring(backCenter);
  const push = (a: Vec3, b: Vec3, c: Vec3) => points.push(...a, ...b, ...c);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    push(front[index], back[index], back[next]);
    push(front[index], back[next], front[next]);
    push(tip, front[next], front[index]);
    push(backCenter, back[index], back[next]);
  }
  return { triangleCount: points.length / 9, coordinates: Float64Array.from(points) };
}

/**
 * Lateral bounding-box centre of the vertices accepted by `accept`. Used for
 * symmetric thread/cross-section measurements where the full turn cancels. A
 * sample with fewer than 12 accepted vertices is inconclusive and returns null.
 */
export function crossSectionCenter(mesh: TriangleMesh, accept: (x: number, y: number, z: number) => boolean): { x: number; y: number; n: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) for (let corner = 0; corner < 3; corner += 1) {
    const base = triangle * 9 + corner * 3;
    const x = mesh.coordinates[base], y = mesh.coordinates[base + 1], z = mesh.coordinates[base + 2];
    if (!accept(x, y, z)) continue;
    n += 1;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return n < 12 ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2, n };
}
