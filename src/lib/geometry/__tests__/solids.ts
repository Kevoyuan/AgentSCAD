/**
 * Synthetic meshes for collision tests. Closed, axis-aligned boxes and a tube,
 * so the expected answer is arithmetic rather than a picture. These are
 * original fixtures; they do not represent any real part.
 */
import { readBinaryStl, type TriangleMesh } from "../stl-mesh";

function stlFrom(triangles: number[][][]): Buffer {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const start = 84 + 50 * index + 12;
    triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
  });
  return buffer;
}

/** Closed box as 12 triangles; winding is outward but the tests never rely on it. */
export function boxTriangles(min: [number, number, number], max: [number, number, number]): number[][][] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = (x: number, y: number, z: number) => [x, y, z];
  const corners = {
    a: v(x0, y0, z0), b: v(x1, y0, z0), c: v(x1, y1, z0), d: v(x0, y1, z0),
    e: v(x0, y0, z1), f: v(x1, y0, z1), g: v(x1, y1, z1), h: v(x0, y1, z1),
  };
  const quad = (p: number[], q: number[], r: number[], s: number[]) => [[p, q, r], [p, r, s]];
  return [
    ...quad(corners.a, corners.d, corners.c, corners.b), // z0
    ...quad(corners.e, corners.f, corners.g, corners.h), // z1
    ...quad(corners.a, corners.b, corners.f, corners.e), // y0
    ...quad(corners.b, corners.c, corners.g, corners.f), // x1
    ...quad(corners.c, corners.d, corners.h, corners.g), // y1
    ...quad(corners.d, corners.a, corners.e, corners.h), // x0
  ];
}

export function boxStl(min: [number, number, number], max: [number, number, number]): Buffer {
  return stlFrom(boxTriangles(min, max));
}

/** Two boxes in one mesh, used to prove that overlapping bounds are not a collision. */
export function twoBoxesStl(): Buffer {
  return stlFrom([...boxTriangles([0, 0, 0], [1, 1, 1]), ...boxTriangles([3, 3, 0], [4, 4, 1])]);
}

/** Hollow cylinder: outer wall, inner wall and two annular caps. */
export function tubeStl(options: { outerRadius: number; innerRadius: number; height: number; segments: number; z0?: number }): Buffer {
  const { outerRadius, innerRadius, height, segments } = options;
  const z0 = options.z0 ?? 0, z1 = z0 + height;
  const ring = (radius: number, z: number) =>
    Array.from({ length: segments }, (_, i) => {
      const angle = (2 * Math.PI * i) / segments;
      return [radius * Math.cos(angle), radius * Math.sin(angle), z];
    });
  const outerBottom = ring(outerRadius, z0), outerTop = ring(outerRadius, z1);
  const innerBottom = ring(innerRadius, z0), innerTop = ring(innerRadius, z1);
  const triangles: number[][][] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    triangles.push([outerBottom[i], outerBottom[j], outerTop[j]], [outerBottom[i], outerTop[j], outerTop[i]]);
    triangles.push([innerBottom[i], innerTop[j], innerBottom[j]], [innerBottom[i], innerTop[i], innerTop[j]]);
    triangles.push([outerBottom[i], innerBottom[j], outerBottom[j]], [outerBottom[i], innerBottom[i], innerBottom[j]]);
    triangles.push([outerTop[i], outerTop[j], innerTop[j]], [outerTop[i], innerTop[j], innerTop[i]]);
  }
  return stlFrom(triangles);
}

export function meshOf(stl: Buffer): TriangleMesh {
  return readBinaryStl(stl);
}

/** Concatenates triangle tables, so one part can be several solids. */
export function mergeStl(...buffers: Buffer[]): Buffer {
  const counts = buffers.map((buffer) => buffer.readUInt32LE(80));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const out = Buffer.alloc(84 + 50 * total);
  out.writeUInt32LE(total, 80);
  let offset = 84;
  for (const buffer of buffers) {
    const bytes = buffer.subarray(84);
    bytes.copy(out, offset);
    offset += bytes.length;
  }
  return out;
}

/** Row-major 4x4 rotation about +Z. */
export function rotationZ(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function translation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}
