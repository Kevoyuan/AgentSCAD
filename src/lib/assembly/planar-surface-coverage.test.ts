import { describe, expect, test } from "bun:test";
import { boxStl, mergeStl } from "../geometry/__tests__/solids";
import { readBinaryStl, type Vec3 } from "../geometry/stl-mesh";
import { checkReconstructedMesh } from "./reconstructed-mesh-check";
import { comparePlanarSurfaceCoverage } from "./planar-surface-coverage";

const id = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
type Triangle = [Vec3, Vec3, Vec3];
function triangles(stl: Buffer): Triangle[] {
  const coordinates = readBinaryStl(stl).coordinates;
  const result: Triangle[] = [];
  for (let i = 0; i < coordinates.length; i += 9) {
    result.push([
      [coordinates[i], coordinates[i+1], coordinates[i+2]],
      [coordinates[i+3], coordinates[i+4], coordinates[i+5]],
      [coordinates[i+6], coordinates[i+7], coordinates[i+8]],
    ]);
  }
  return result;
}
function stlOf(faces: Triangle[]): Buffer {
  const b = Buffer.alloc(84 + faces.length * 50);
  b.writeUInt32LE(faces.length, 80);
  faces.forEach((tri, i) => tri.forEach((p, j) => p.forEach((v, k) =>
    b.writeFloatLE(v, 84 + i * 50 + 12 + 12 * j + 4 * k))));
  return b;
}
const original = boxStl([0,0,0],[2,2,2]);
const split = (base: Triangle[], i: number): Triangle[] => {
  const [a,b,c] = base[i];
  const mid: Vec3 = [0,1,2].map(k => (a[k]+b[k]+c[k])/3) as Vec3;
  return [
    ...base.slice(0,i),
    [a,b,mid] as Triangle,
    [b,c,mid] as Triangle,
    [c,a,mid] as Triangle,
    ...base.slice(i+1),
  ];
};

describe("bounded triangulation-independent planar surface area coverage", () => {
  test("genuinely equivalent retessellation of a whole box PASSES bidirectionally", () => {
    const retriangulated = stlOf(split(triangles(original), 0));
    expect(readBinaryStl(retriangulated).triangleCount).toBe(14);
    const forward = checkReconstructedMesh({ local: original, posed: retriangulated, transform: id });
    const reverse = checkReconstructedMesh({ local: retriangulated, posed: original, transform: id });
    expect(forward.status).toBe("PASS");
    expect(reverse.status).toBe("PASS");
    expect(forward.method).toBe("bidirectional-coplanar-triangle-area/v1");
    expect("testedPairs" in forward && forward.testedPairs).toBeGreaterThan(0);
    expect("maximumAreaMismatchMm2" in forward && forward.maximumAreaMismatchMm2).toBeLessThan(1e-6);
  });

  test("removing an interior subfacet cannot PASS even though the bounding box is identical", () => {
    const pieces = split(triangles(original), 0);
    const missing = stlOf(pieces.filter((_, i) => i !== 1));
    const result = checkReconstructedMesh({ local: original, posed: missing, transform: id });
    expect(result.bboxErrorMm).toBe(0);
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("unproven surface coverage");
  });

  test("additional internal geometry cannot PASS with matching envelope", () => {
    const extra = mergeStl(original, boxStl([0.5,0.5,0.5],[0.6,0.6,0.6]));
    const result = checkReconstructedMesh({ local: original, posed: extra, transform: id });
    expect(result.bboxErrorMm).toBe(0);
    expect(result.status).not.toBe("PASS");
  });

  test("duplicated overlapping triangles cannot overcount coverage into a PASS", () => {
    const originalTriangles = triangles(original);
    const duplicate = stlOf([...originalTriangles, originalTriangles[0]]);
    const result = checkReconstructedMesh({ local: original, posed: duplicate, transform: id });
    expect(result.status).toBe("NOT_RUN");
  });

  test("noncoplanar bent facet cannot be hidden by coincident triangle projections", () => {
    const bent = triangles(original);
    const b = bent[0];
    bent[0] = [b[0], b[1], [b[2][0], b[2][1], b[2][2] === 2 ? 1.9 : 0.1]];
    const result = checkReconstructedMesh({ local: original, posed: stlOf(bent), transform: id });
    expect(result.status).not.toBe("PASS");
  });

  test("tolerances and pathological budgets never imply a hidden PASS", () => {
    const base = triangles(original);
    const changed = split(base,0);
    const bounded = comparePlanarSurfaceCoverage(base,changed,1e-4,1);
    expect(bounded.status).toBe("NOT_RUN");
    expect(bounded.reason).toContain("budget");
    const degenerate: Triangle = [[0,0,0],[0,0,0],[0,0,0]];
    const unknown = comparePlanarSurfaceCoverage([...base, degenerate],base,1e-4);
    expect(unknown.status).toBe("NOT_RUN");
    expect(unknown.reason).toContain("Degenerate");
    expect(() => comparePlanarSurfaceCoverage(base, changed, 10)).toThrow();
  });
});
