/**
 * Deterministic geometry primitives over binary STL.
 *
 * Everything here measures the triangles that were actually produced by a
 * renderer. It does not prove that those triangles belong to the intended part,
 * that the mesh is watertight, that a section is representative of the solid,
 * or that any number transfers to a manufactured object. Float32 storage in the
 * file bounds the meaningful resolution to roughly 1e-6 mm at typical part
 * sizes; callers must not claim more.
 */
export type Vec3 = [number, number, number];

const MAX_TRIANGLES = 2_000_000;
/** Binary STL stores float32, so differences below this are not meaningful. */
const VERTEX_EPSILON_MM = 1e-6;

export interface TriangleMesh {
  /** Nine coordinates per triangle: ax ay az bx by bz cx cy cz. */
  coordinates: Float64Array;
  triangleCount: number;
}

export function readBinaryStl(stl: Buffer): TriangleMesh {
  if (!Buffer.isBuffer(stl) || stl.length < 84) throw new Error("Invalid binary STL header");
  const triangleCount = stl.readUInt32LE(80);
  if (!triangleCount || triangleCount > MAX_TRIANGLES || 84 + 50 * triangleCount !== stl.length) {
    throw new Error("Invalid or oversized binary STL triangle table");
  }
  const coordinates = new Float64Array(triangleCount * 9);
  for (let i = 0; i < triangleCount; i++) {
    const start = 84 + 50 * i + 12;
    for (let k = 0; k < 9; k++) {
      const value = stl.readFloatLE(start + k * 4);
      if (!Number.isFinite(value)) throw new Error("Non-finite STL vertex");
      coordinates[i * 9 + k] = value;
    }
  }
  return { coordinates, triangleCount };
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length <= 0) throw new Error("Direction must be a finite nonzero vector");
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Two unit vectors spanning the plane whose normal is `normal`.
 * The first is the projection of the least-aligned global axis, so a section
 * normal to +Z reports x/y coordinates a caller can read directly.
 */
export function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = normalize(normal);
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const helper: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const along = dot(n, helper);
  const u = normalize([helper[0] - n[0] * along, helper[1] - n[1] * along, helper[2] - n[2] * along]);
  return { u, v: cross(n, u) };
}

export interface SectionSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface MeshSection {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  segments: SectionSegment[];
  /** Triangles that crossed the plane but did not yield a clean two-point cut. */
  dropped: number;
}

/**
 * Intersects every triangle with a plane and returns the cut as 2D segments in
 * the plane basis. A plane that passes exactly through a vertex or an edge is
 * handled explicitly; a triangle coplanar with the plane contributes nothing.
 */
export function sectionMesh(mesh: TriangleMesh, origin: Vec3, normal: Vec3): MeshSection {
  const n = normalize(normal);
  const { u, v } = planeBasis(n);
  const segments: SectionSegment[] = [];
  let dropped = 0;
  const distance = [0, 0, 0];
  const point: Array<[number, number]> = [[0, 0], [0, 0], [0, 0]];
  const onPlane = [false, false, false];
  const { coordinates } = mesh;

  for (let t = 0; t < mesh.triangleCount; t++) {
    const base = t * 9;
    for (let i = 0; i < 3; i++) {
      const dx = coordinates[base + i * 3] - origin[0];
      const dy = coordinates[base + i * 3 + 1] - origin[1];
      const dz = coordinates[base + i * 3 + 2] - origin[2];
      distance[i] = dx * n[0] + dy * n[1] + dz * n[2];
      onPlane[i] = Math.abs(distance[i]) <= VERTEX_EPSILON_MM;
      point[i][0] = dx * u[0] + dy * u[1] + dz * u[2];
      point[i][1] = dx * v[0] + dy * v[1] + dz * v[2];
    }
    if (onPlane[0] && onPlane[1] && onPlane[2]) continue;

    // Collect boundary crossings; vertices exactly on the plane count once.
    const found: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) if (onPlane[i]) found.push(point[i]);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (onPlane[i] || onPlane[j]) continue;
      if ((distance[i] < 0) === (distance[j] < 0)) continue;
      const f = distance[i] / (distance[i] - distance[j]);
      found.push([
        point[i][0] + (point[j][0] - point[i][0]) * f,
        point[i][1] + (point[j][1] - point[i][1]) * f,
      ]);
    }

    // Deduplicate without changing order: a repeated on-plane vertex must not
    // become a zero-length segment.
    const unique: Array<[number, number]> = [];
    for (const candidate of found) {
      if (!unique.some((existing) => Math.hypot(existing[0] - candidate[0], existing[1] - candidate[1]) <= VERTEX_EPSILON_MM)) {
        unique.push(candidate);
      }
    }
    if (unique.length === 2) {
      segments.push({ ax: unique[0][0], ay: unique[0][1], bx: unique[1][0], by: unique[1][1] });
    } else if (unique.length > 2) {
      dropped++;
    }
  }
  return { origin, normal: n, u, v, segments, dropped };
}

export interface RadialProfile {
  center: [number, number];
  /** Distance from the centre to the first surface along each ray, NaN when nothing was hit. */
  radii: Float64Array;
  /** Two coordinates per ray, in section coordinates. */
  points: Float64Array;
  misses: number;
}

/**
 * Casts `rays` evenly spaced rays from `center` and records the nearest
 * intersection with the section. The nearest hit is what a pin gauge would
 * touch: it is the inner wall for a bore and the outer wall for a shaft.
 */
export function castRadialProfile(section: MeshSection, center: [number, number], rays: number, maxRadiusMm: number): RadialProfile {
  if (!Number.isSafeInteger(rays) || rays < 3 || rays > 100_000) throw new Error("Ray count must be an integer between 3 and 100000");
  if (!Number.isFinite(maxRadiusMm) || maxRadiusMm <= 0) throw new Error("Search radius must be finite and positive");
  const radii = new Float64Array(rays);
  const points = new Float64Array(rays * 2);
  const segments = section.segments;
  let misses = 0;
  for (let r = 0; r < rays; r++) {
    const angle = (2 * Math.PI * r) / rays;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = Infinity;
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s];
      const ex = segment.bx - segment.ax, ey = segment.by - segment.ay;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) continue;
      const ox = segment.ax - center[0], oy = segment.ay - center[1];
      const t = (ox * ey - oy * ex) / denominator;
      if (!(t >= 0) || t > maxRadiusMm || t >= best) continue;
      const u = (ox * dy - oy * dx) / denominator;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      best = t;
    }
    if (best === Infinity) {
      misses++;
      radii[r] = NaN;
      points[r * 2] = NaN;
      points[r * 2 + 1] = NaN;
    } else {
      radii[r] = best;
      points[r * 2] = center[0] + dx * best;
      points[r * 2 + 1] = center[1] + dy * best;
    }
  }
  return { center, radii, points, misses };
}

/**
 * Shifts the cast centre onto the feature centre. For a centred regular
 * polygon the first radial harmonic vanishes, so its amplitude is the offset
 * between the seed and the true centre. Iterating removes the second-order
 * error that a single harmonic estimate leaves on a polygonal profile.
 */
export function refineProfileCenter(section: MeshSection, seed: [number, number], rays: number, maxRadiusMm: number, iterations = 8): { profile: RadialProfile; converged: boolean } {
  let center: [number, number] = [seed[0], seed[1]];
  let profile = castRadialProfile(section, center, rays, maxRadiusMm);
  for (let i = 0; i < iterations; i++) {
    if (profile.misses > 0) return { profile, converged: false };
    let cos = 0, sin = 0;
    for (let r = 0; r < rays; r++) {
      const angle = (2 * Math.PI * r) / rays;
      cos += profile.radii[r] * Math.cos(angle);
      sin += profile.radii[r] * Math.sin(angle);
    }
    const shiftX = (2 * cos) / rays, shiftY = (2 * sin) / rays;
    if (!Number.isFinite(shiftX) || !Number.isFinite(shiftY)) return { profile, converged: false };
    if (Math.hypot(shiftX, shiftY) <= 1e-6) return { profile, converged: true };
    center = [center[0] + shiftX, center[1] + shiftY];
    profile = castRadialProfile(section, center, rays, maxRadiusMm);
  }
  return { profile, converged: false };
}

export interface ProfileShape {
  radiusMinMm: number;
  radiusMaxMm: number;
  /** Facet count when the profile is a regular polygon; null when it is a smooth circle. */
  segmentCount: number | null;
  /** Largest deviation from the fitted regular polygon, in mm. */
  formErrorMm: number;
  /** True when the profile is a regular polygon or a circle within the stated tolerance. */
  cylindrical: boolean;
  reason: string;
}

/**
 * Decides whether the measured radial profile is the cross-section of a
 * faceted cylinder. A tessellated cylinder is a regular polygon, so the ratio
 * of inradius to circumradius fixes the facet count and the residual against
 * that polygon separates a real bore from an ellipse, a slot or a wrong axis.
 */
export function analyzeProfile(profile: RadialProfile): ProfileShape {
  if (profile.misses > 0) {
    return { radiusMinMm: NaN, radiusMaxMm: NaN, segmentCount: null, formErrorMm: NaN, cylindrical: false, reason: `${profile.misses} rays missed the solid, so the section does not enclose the seed axis.` };
  }
  let min = Infinity, max = -Infinity, maxIndex = 0;
  for (let i = 0; i < profile.radii.length; i++) {
    const value = profile.radii[i];
    if (!Number.isFinite(value) || value <= 0) {
      return { radiusMinMm: NaN, radiusMaxMm: NaN, segmentCount: null, formErrorMm: NaN, cylindrical: false, reason: "A ray returned an invalid distance." };
    }
    if (value < min) min = value;
    if (value > max) { max = value; maxIndex = i; }
  }
  const tolerance = Math.max(1e-3, max * 1e-4);
  if (max - min <= tolerance) {
    return { radiusMinMm: min, radiusMaxMm: max, segmentCount: null, formErrorMm: 0, cylindrical: true, reason: "The profile is circular to within the stated tolerance; no facet count was resolved." };
  }
  const ratio = min / max;
  const nExact = Math.PI / Math.acos(Math.min(1, Math.max(-1, ratio)));
  const n = Math.round(nExact);
  if (!(n >= 3 && n <= 4096) || Math.abs(nExact - n) > 0.25) {
    return { radiusMinMm: min, radiusMaxMm: max, segmentCount: null, formErrorMm: Infinity, cylindrical: false, reason: `The profile is not a regular polygon: the inradius/circumradius ratio implies ${nExact.toFixed(2)} facets.` };
  }
  const vertexAngle = (2 * Math.PI * maxIndex) / profile.radii.length;
  const inradius = max * Math.cos(Math.PI / n);
  const period = (2 * Math.PI) / n;
  let formError = 0;
  for (let i = 0; i < profile.radii.length; i++) {
    const angle = (2 * Math.PI * i) / profile.radii.length;
    let delta = (angle - vertexAngle - Math.PI / n) % period;
    if (delta > period / 2) delta -= period;
    if (delta < -period / 2) delta += period;
    const model = inradius / Math.cos(delta);
    const error = Math.abs(profile.radii[i] - model);
    if (error > formError) formError = error;
  }
  const cylindrical = formError <= tolerance;
  return {
    radiusMinMm: min, radiusMaxMm: max, segmentCount: n, formErrorMm: formError, cylindrical,
    reason: cylindrical
      ? `The profile is a regular ${n}-gon within ${tolerance.toExponential(1)} mm.`
      : `The profile is not a regular ${n}-gon: maximum deviation ${formError.toFixed(4)} mm exceeds ${tolerance.toFixed(4)} mm.`,
  };
}

export function meshBounds(mesh: TriangleMesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.coordinates.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = mesh.coordinates[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  return { min, max };
}

/** Extent of the mesh projected on an axis, used to place measurement stations. */
export function extentAlongAxis(mesh: TriangleMesh, origin: Vec3, direction: Vec3): { min: number; max: number } {
  const d = normalize(direction);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < mesh.coordinates.length; i += 3) {
    const value = (mesh.coordinates[i] - origin[0]) * d[0] + (mesh.coordinates[i + 1] - origin[1]) * d[1] + (mesh.coordinates[i + 2] - origin[2]) * d[2];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}
