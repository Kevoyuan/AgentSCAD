import fs from "fs/promises";
import sharp from "sharp";

const WIDTH = 800;
const HEIGHT = 600;
const MARGIN = 48;
const MAX_PREVIEW_TRIANGLES = 100_000;

interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface ProjectedTriangle {
  points: [Point3, Point3, Point3];
  depth: number;
  shade: number;
}

function readPoint(view: DataView, offset: number): Point3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

function isFinitePoint(point: Point3): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function cross(a: Point3, b: Point3, c: Point3): Point3 {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  return {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
}

function shadeFor(a: Point3, b: Point3, c: Point3): number {
  const normal = cross(a, b, c);
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const light = { x: 0.35, y: -0.45, z: 0.82 };
  const dot =
    (normal.x * light.x + normal.y * light.y + normal.z * light.z) /
    length;
  return Math.round(92 + Math.max(0, dot) * 118);
}

function project(point: Point3) {
  return {
    x: (point.x - point.y) * 0.8660254,
    y: (point.x + point.y) * 0.5 - point.z,
  };
}

export function inspectBinaryStl(buffer: Buffer): {
  triangleCount: number;
  triangles: ProjectedTriangle[];
} {
  if (buffer.length < 84) throw new Error("STL is shorter than its binary header");
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  const triangleCount = view.getUint32(80, true);
  const expectedSize = 84 + triangleCount * 50;
  if (triangleCount === 0 || expectedSize > buffer.length) {
    throw new Error("STL has an invalid binary triangle table");
  }
  if (triangleCount > MAX_PREVIEW_TRIANGLES) {
    throw new Error(
      `STL has ${triangleCount} triangles; preview limit is ${MAX_PREVIEW_TRIANGLES}`
    );
  }

  const triangles: ProjectedTriangle[] = [];
  for (let index = 0; index < triangleCount; index += 1) {
    const base = 84 + index * 50 + 12;
    const a = readPoint(view, base);
    const b = readPoint(view, base + 12);
    const c = readPoint(view, base + 24);
    if (![a, b, c].every(isFinitePoint)) continue;
    triangles.push({
      points: [a, b, c],
      depth:
        (a.x + a.y + a.z + b.x + b.y + b.z + c.x + c.y + c.z) / 3,
      shade: shadeFor(a, b, c),
    });
  }
  if (triangles.length === 0) throw new Error("STL contains no finite triangles");
  return { triangleCount, triangles };
}

export async function renderBinaryStlPreview(
  stlBuffer: Buffer,
  pngFilePath: string
): Promise<{ triangleCount: number }> {
  const { triangleCount, triangles } = inspectBinaryStl(stlBuffer);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const triangle of triangles) {
    for (const point of triangle.points.map(project)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const scale = Math.min(
    (WIDTH - MARGIN * 2) / Math.max(maxX - minX, 0.001),
    (HEIGHT - MARGIN * 2) / Math.max(maxY - minY, 0.001)
  );
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;

  const polygons = triangles
    // The camera looks from the positive (1, 1, 1) direction, so larger
    // depth values are nearer. Paint far faces first so near faces occlude them.
    .sort((left, right) => left.depth - right.depth)
    .map((triangle) => {
      const points = triangle.points
        .map(project)
        .map(
          (point) =>
            `${(point.x * scale + offsetX).toFixed(2)},${(
              point.y * scale +
              offsetY
            ).toFixed(2)}`
        )
        .join(" ");
      const blue = Math.min(255, triangle.shade + 28);
      return `<polygon points="${points}" fill="rgb(34,${triangle.shade},${blue})" stroke="rgba(6,41,55,0.28)" stroke-width="0.45"/>`;
    })
    .join("");

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#f4f8fa"/><g>${polygons}</g></svg>`
  );
  await sharp(svg).png({ compressionLevel: 9 }).toFile(pngFilePath);
  return { triangleCount };
}

export async function renderStlFilePreview(
  stlFilePath: string,
  pngFilePath: string
): Promise<{ triangleCount: number }> {
  return renderBinaryStlPreview(await fs.readFile(stlFilePath), pngFilePath);
}
