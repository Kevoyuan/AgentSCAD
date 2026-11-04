/**
 * Synthetic prisms for measurement tests. These are original fixtures: they
 * exist to test the measurement code, not to represent any real part.
 */
export function prismStl(options: {
  radius: number;
  /** Different value produces an ellipse, used as a negative case. */
  radiusY?: number;
  height: number;
  segments: number;
  center?: [number, number];
  z0?: number;
}): Buffer {
  const { radius, height, segments } = options;
  const radiusY = options.radiusY ?? radius;
  const [cx, cy] = options.center ?? [0, 0];
  const z0 = options.z0 ?? 0;
  const z1 = z0 + height;
  const triangles: number[][][] = [];
  const ring = (z: number) =>
    Array.from({ length: segments }, (_, i) => {
      const angle = (2 * Math.PI * i) / segments;
      return [cx + radius * Math.cos(angle), cy + radiusY * Math.sin(angle), z];
    });
  const bottom = ring(z0);
  const top = ring(z1);
  const bottomCentre = [cx, cy, z0];
  const topCentre = [cx, cy, z1];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    triangles.push([bottom[i], bottom[j], top[j]]);
    triangles.push([bottom[i], top[j], top[i]]);
    triangles.push([bottomCentre, bottom[j], bottom[i]]);
    triangles.push([topCentre, top[i], top[j]]);
  }
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const start = 84 + 50 * index + 12;
    triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
  });
  return buffer;
}
