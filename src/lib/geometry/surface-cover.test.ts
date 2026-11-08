import { expect, test } from "bun:test";
import { compareSurfaceCover } from "./surface-cover";
import { boxTriangles, boxStl, mergeStl, translation } from "./__tests__/solids";

function stl(triangles: number[][][]) {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, i) => triangle.flat().forEach((value, k) => buffer.writeFloatLE(value, 96 + i * 50 + k * 4)));
  return buffer;
}

const identity = translation(0, 0, 0);
const triangles = boxTriangles([0, 0, 0], [2, 3, 4]);
const original = stl(triangles);

test("bidirectional convex cover accepts alternate face diagonals and refinement", () => {
  const flipped: number[][][] = [];
  for (let i = 0; i < triangles.length; i += 2) {
    const [a, b, c] = triangles[i], d = triangles[i + 1][2];
    flipped.push([a, b, d], [b, c, d]);
  }
  const refined = triangles.flatMap(([a, b, c]) => {
    const center = a.map((value, k) => (value + b[k] + c[k]) / 3);
    return [[a, b, center], [b, c, center], [c, a, center]];
  });
  for (const posed of [stl(flipped), stl(refined), stl(flipped.map(triangle => [...triangle].reverse()))]) {
    const result = compareSurfaceCover({ local: original, posed, transform: identity });
    expect(result.status).toBe("PASS");
    expect(result.maxCertifiedFragmentDistanceMm).toBeLessThanOrEqual(1e-4);
  }
});

test("matching bounds and vertices cannot hide missing faces or extra interior surfaces", () => {
  const missing = stl(triangles.slice(2));
  const extra = mergeStl(original, boxStl([0.3, 0.3, 0.3], [0.6, 0.6, 0.6]));
  for (const posed of [missing, extra]) {
    expect(compareSurfaceCover({ local: original, posed, transform: identity }).status).toBe("NOT_RUN");
  }
  expect(compareSurfaceCover({ local: missing, posed: original, transform: identity }).status).toBe("NOT_RUN");
});

test("equal boundary vertices do not certify different nonplanar interiors", () => {
  const a = [0,0,0], b = [2,0,0], c = [2,2,1], d = [0,2,0];
  const first = stl([[a,b,c], [a,c,d]]);
  const second = stl([[a,b,d], [b,c,d]]);
  expect(compareSurfaceCover({ local: first, posed: second, transform: identity }).status).toBe("NOT_RUN");
});

test("an uncovered interior hole remains uncertified even with identical outer boundaries", () => {
  const quad = (x0: number, y0: number, x1: number, y1: number) => [
    [[x0,y0,0], [x1,y0,0], [x1,y1,0]], [[x0,y0,0], [x1,y1,0], [x0,y1,0]]
  ];
  const full = stl(quad(0,0,2,2));
  const ring = stl([...quad(0,0,2,.9), ...quad(0,1.1,2,2), ...quad(0,.9,.9,1.1), ...quad(1.1,.9,2,1.1)]);
  expect(compareSurfaceCover({ local: full, posed: ring, transform: identity }).status).toBe("NOT_RUN");
  expect(compareSurfaceCover({ local: ring, posed: full, transform: identity }).status).toBe("NOT_RUN");
});

test("guarded cover preserves distance tolerances and deterministic resource limits", () => {
  const moved = stl(triangles.map(triangle => triangle.map(([x, y, z]) => [x + 4, y + 5, z + 6])));
  expect(compareSurfaceCover({ local: original, posed: moved, transform: translation(4, 5, 6) }).status).toBe("PASS");
  expect(compareSurfaceCover({ local: original, posed: moved, transform: translation(4, 5, 6.01) }).status).toBe("NOT_RUN");
  expect(compareSurfaceCover({ local: original, posed: moved, transform: translation(4, 5, 6), maxClipTests: 1 }).status).toBe("NOT_RUN");
  expect(() => compareSurfaceCover({ local: original, posed: moved, transform: identity, toleranceMm: NaN })).toThrow();
  expect(compareSurfaceCover({ local: original, posed: stl([[...triangles[0]].fill([0,0,0])]), transform: identity }).status).toBe("NOT_RUN");
});
