import { describe, expect, test } from "bun:test";
import {
  buildBvh,
  bvhIntersects,
  classifyPoint,
  meshesIntersect,
  placeBvh,
  transformPoint,
  trianglesIntersect,
  type Mat4,
} from "../mesh-collision";
import { boxStl, mergeStl, meshOf, rotationZ, translation, tubeStl, twoBoxesStl } from "./solids";
import { prismStl } from "./prism";

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("triangle-triangle intersection", () => {
  test("two triangles that cross in space intersect", () => {
    // A in the z=0 plane, B standing vertically through it.
    expect(trianglesIntersect([0, 0, 0], [2, 0, 0], [0, 2, 0], [0.5, 0.5, -1], [1.5, 0.5, 1], [0.5, 1.5, 1])).toBe(true);
  });

  test("triangles on the same plane with no overlap are separated", () => {
    expect(trianglesIntersect([0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 5, 0], [6, 5, 0], [5, 6, 0])).toBe(false);
  });

  test("coplanar triangles that overlap are reported as intersecting", () => {
    // The coplanar branch runs the separating-axis test, not a plane-sign test.
    expect(trianglesIntersect([0, 0, 0], [4, 0, 0], [0, 4, 0], [1, 1, 0], [3, 1, 0], [1, 3, 0])).toBe(true);
  });

  test("a degenerate triangle is never a colliding surface", () => {
    expect(trianglesIntersect([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBe(false);
  });

  test("parallel planes that do not meet are separated", () => {
    expect(trianglesIntersect([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 5], [1, 0, 5], [0, 1, 5])).toBe(false);
  });
});

describe("bounding volume hierarchy", () => {
  test("the same mesh always produces the same tree", () => {
    const mesh = meshOf(boxStl([0, 0, 0], [10, 3, 2]));
    const a = buildBvh(mesh), b = buildBvh(mesh);
    expect(Array.from(a.order)).toEqual(Array.from(b.order));
    expect(Array.from(a.bounds)).toEqual(Array.from(b.bounds));
    expect(a.nodeCount).toBe(b.nodeCount);
  });

  test("every triangle appears exactly once in the leaf order", () => {
    const mesh = meshOf(twoBoxesStl());
    const bvh = buildBvh(mesh, 2);
    const seen = new Set(Array.from(bvh.order));
    expect(seen.size).toBe(mesh.triangleCount);
    expect(bvh.order.length).toBe(mesh.triangleCount);
  });

  test("placed bounds contain every transformed vertex", () => {
    const mesh = meshOf(boxStl([-2, -1, 0], [2, 1, 3]));
    const placed = placeBvh(buildBvh(mesh), rotationZ(37));
    for (let i = 0; i < mesh.triangleCount; i++) {
      for (let v = 0; v < 3; v++) {
        const point = transformPoint(rotationZ(37), [
          mesh.coordinates[i * 9 + v * 3], mesh.coordinates[i * 9 + v * 3 + 1], mesh.coordinates[i * 9 + v * 3 + 2],
        ]);
        for (let axis = 0; axis < 3; axis++) {
          expect(point[axis]).toBeGreaterThanOrEqual(placed.worldBounds[axis] - 1e-9);
          expect(point[axis]).toBeLessThanOrEqual(placed.worldBounds[3 + axis] + 1e-9);
        }
      }
    }
  });

  test("a non-finite matrix is refused instead of producing nonsense bounds", () => {
    expect(() => placeBvh(buildBvh(meshOf(boxStl([0, 0, 0], [1, 1, 1]))), [1, 0, 0, NaN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toThrow(/finite 4x4/);
  });
});

describe("mesh interference", () => {
  const block = meshOf(boxStl([0, 0, 0], [10, 10, 10]));

  test("two boxes that share volume intersect, and the offending triangles are named", () => {
    const result = meshesIntersect(block, IDENTITY, meshOf(boxStl([8, 8, 8], [12, 12, 12])), IDENTITY);
    expect(result.status).toBe("INTERSECT");
    expect(result.blocked).toBe(true);
    expect(result.pair).not.toBeNull();
    expect(result.reason).toMatch(/Triangles \d+ and \d+ intersect/);
  });

  test("disjoint bounds are separated without any triangle tests", () => {
    const result = meshesIntersect(block, IDENTITY, meshOf(boxStl([20, 20, 20], [22, 22, 22])), IDENTITY);
    expect(result.status).toBe("SEPARATED");
    expect(result.blocked).toBe(false);
    expect(result.testedPairs).toBe(0);
    expect(result.reason).toContain("bounds do not overlap");
  });

  test("multi-component overlapping bounds are checked per component", () => {
    const result = meshesIntersect(meshOf(twoBoxesStl()), IDENTITY, meshOf(boxStl([1.5, 1.5, 0.2], [2.5, 2.5, 0.8])), IDENTITY);
    expect(result.status).toBe("SEPARATED");
    expect(result.blocked).toBe(false);
  });

  test("an unsampled embedded component cannot masquerade as separated", () => {
    const outer = mergeStl(...Array.from({ length: 20 }, (_, i) =>
      boxStl([i * 3, 0, 0], [i * 3 + 1, 1, 1])));
    const inner = mergeStl(...Array.from({ length: 20 }, (_, i) =>
      boxStl([i * 3 + 0.2, i === 1 ? 0.2 : 2, 0.2], [i * 3 + 0.8, i === 1 ? 0.8 : 2.6, 0.8])));
    // The second component of inner lies wholly inside the second box of outer.
    // Before the topology guard this exact pair returned SEPARATED.
    const result = meshesIntersect(meshOf(outer), IDENTITY, meshOf(inner), IDENTITY);
    expect(result.status).toBe("CONTAINED");
    expect(result.blocked).toBe(true);
  });

  test("touching faces are reported as intersecting, because the test cannot tell contact from penetration", () => {
    const result = meshesIntersect(block, IDENTITY, meshOf(boxStl([10, 0, 0], [12, 10, 10])), IDENTITY);
    expect(result.status).toBe("INTERSECT");
  });

  test("a shaft with no bore is contained, not separated", () => {
    // Fully inside the block: centred at (5, 5), radius 2, z 2..8 within 0..10.
    const pin = meshOf(prismStl({ radius: 2, height: 6, segments: 32, center: [5, 5], z0: 2 }));
    const result = meshesIntersect(pin, IDENTITY, block, IDENTITY);
    // Nothing crosses: the pin's surface is entirely inside the block's solid.
    expect(result.status).toBe("CONTAINED");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("solids interfere");
  });

  test("a shaft in a bore with clearance is separated, and the same shaft oversize is not", () => {
    const tube = meshOf(tubeStl({ outerRadius: 3, innerRadius: 2.5, height: 10, segments: 64 }));
    const fits = meshesIntersect(meshOf(prismStl({ radius: 2.4, height: 12, segments: 64, z0: -1 })), IDENTITY, tube, IDENTITY);
    expect(fits.status).toBe("SEPARATED");
    expect(fits.blocked).toBe(false);

    const oversize = meshesIntersect(meshOf(prismStl({ radius: 2.6, height: 12, segments: 64, z0: -1 })), IDENTITY, tube, IDENTITY);
    expect(oversize.status).toBe("INTERSECT");
    expect(oversize.blocked).toBe(true);
  });

  test("a rotation can turn clearance into interference", () => {
    const leaf = meshOf(boxStl([-5, 0, 0], [5, 1, 1]));
    const obstacle = meshOf(boxStl([0.5, 3, 0], [1.5, 4, 1]));
    const bvh = buildBvh(leaf);
    expect(bvhIntersects(placeBvh(bvh, IDENTITY), placeBvh(buildBvh(obstacle), IDENTITY)).status).toBe("SEPARATED");
    const rotated = bvhIntersects(placeBvh(bvh, rotationZ(-90)), placeBvh(buildBvh(obstacle), IDENTITY));
    expect(rotated.status).toBe("INTERSECT");
    // The same tree served both poses; nothing was rebuilt.
    expect(bvh.nodeCount).toBeGreaterThan(0);
  });

  test("a translation moves a part in and out of contact", () => {
    const a = meshOf(boxStl([0, 0, 0], [1, 1, 1]));
    const b = meshOf(boxStl([0, 0, 0], [1, 1, 1]));
    expect(meshesIntersect(a, IDENTITY, b, translation(0, 0, 3)).status).toBe("SEPARATED");
    expect(meshesIntersect(a, IDENTITY, b, translation(0, 0, 0.5)).status).toBe("INTERSECT");
  });

  test("exhausting the pair budget is unknown, never clearance", () => {
    // One giant leaf each, so every triangle pair is examined and the budget
    // runs out before the answer is known.
    const a = placeBvh(buildBvh(meshOf(twoBoxesStl()), 1_000_000));
    const b = placeBvh(buildBvh(meshOf(boxStl([1.5, 1.5, 0.2], [2.5, 2.5, 0.8])), 1_000_000));
    const result = bvhIntersects(a, b, { maxPairTests: 5 });
    expect(result.status).toBe("UNKNOWN");
    expect(result.blocked).toBe(true);
    expect(result.budgetExhausted).toBe(true);
    expect(result.reason).toContain("separation is not proven");
  });

  test("an empty mesh is separated with a reason, not an error", () => {
    const empty = { coordinates: new Float64Array(0), triangleCount: 0 };
    const result = meshesIntersect(empty, IDENTITY, block, IDENTITY);
    expect(result.status).toBe("SEPARATED");
    expect(result.reason).toContain("no triangles");
  });

  test("a point classification separates inside from outside", () => {
    const placed = placeBvh(buildBvh(block), IDENTITY);
    expect(classifyPoint([5, 5, 5], placed)).toBe("INSIDE");
    expect(classifyPoint([15, 5, 5], placed)).toBe("OUTSIDE");
  });

  test("an invalid epsilon or budget is refused instead of silently defaulting", () => {
    const a = placeBvh(buildBvh(block));
    const b = placeBvh(buildBvh(block));
    expect(() => bvhIntersects(a, b, { epsilonMm: -1 })).toThrow(/epsilonMm/);
    expect(() => bvhIntersects(a, b, { maxPairTests: 0 })).toThrow(/maxPairTests/);
  });
});
