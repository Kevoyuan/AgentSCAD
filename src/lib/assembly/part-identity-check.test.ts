import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { checkPartIdentity } from "./part-identity-check";

/** Minimal binary STL writer: one triangle per three vertices, no normals needed. */
function stl(triangles: number[][][]): Buffer {
  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    const start = 84 + 50 * index + 12;
    triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
  });
  return buffer;
}

function box(size: number[], offset: number[] = [0, 0, 0]): number[][][] {
  const [x, y, z] = size;
  const [ox, oy, oz] = offset;
  const p = (dx: number, dy: number, dz: number) => [ox + dx, oy + dy, oz + dz];
  return [
    [p(0, 0, 0), p(x, 0, 0), p(x, y, 0)], [p(0, 0, 0), p(x, y, 0), p(0, y, 0)],
    [p(0, 0, z), p(x, y, z), p(x, 0, z)], [p(0, 0, z), p(0, y, z), p(x, y, z)],
  ];
}

const part = (partId: string, selector: string, triangles: number[][][]) => {
  const buffer = stl(triangles);
  return { partId, selector, stl: buffer, sha256: createHash("sha256").update(buffer).digest("hex"), triangleCount: triangles.length };
};

describe("part identity evidence", () => {
  test("distinct renders pass distinctness but cannot pass identity without an assembly mesh", () => {
    const evidence = checkPartIdentity({ parts: [part("base", "base", box([10, 10, 2])), part("lid", "lid", box([10, 10, 2], [0, 0, 4]))] });
    expect(evidence.distinctness.status).toBe("PASS");
    expect(evidence.containment.status).toBe("NOT_RUN");
    expect(evidence.status).toBe("NOT_RUN");
    expect(evidence.reason).toContain("cannot be ruled out");
  });

  test("two selectors returning the same bytes fail instead of becoming two parts", () => {
    const shared = box([10, 10, 2]);
    const evidence = checkPartIdentity({ parts: [part("base", "base", shared), part("lid", "lid", shared)] });
    expect(evidence.status).toBe("FAIL");
    expect(evidence.distinctness.status).toBe("FAIL");
    expect(evidence.distinctness.groups).toEqual([["base", "lid"]]);
    expect(evidence.reason).toContain("not independently selectable");
  });

  test("the same triangles in a different order still fail", () => {
    const triangles = box([10, 10, 2]);
    const reordered = [...triangles].reverse().map((triangle) => [...triangle].reverse());
    const evidence = checkPartIdentity({ parts: [part("base", "base", triangles), part("lid", "lid", reordered)] });
    expect(evidence.distinctness.status).toBe("FAIL");
    expect(evidence.status).toBe("FAIL");
  });

  test("mirrored parts with equal counts and envelopes stay distinct", () => {
    const left = box([10, 10, 2], [-10, 0, 0]);
    const right = box([10, 10, 2], [0, 0, 0]);
    const evidence = checkPartIdentity({ parts: [part("left", "left", left), part("right", "right", right)] });
    expect(evidence.distinctness.status).toBe("PASS");
  });

  test("a part equal to the whole assembly fails containment", () => {
    const whole = box([10, 10, 2]);
    const evidence = checkPartIdentity({ parts: [part("base", "base", whole)], assemblyMesh: { stl: stl(whole) } });
    expect(evidence.containment.status).toBe("FAIL");
    expect(evidence.containment.offenders).toEqual(["base"]);
    expect(evidence.status).toBe("FAIL");
  });

  test("a part larger than the assembly, or outside its envelope, fails containment", () => {
    const whole = box([10, 10, 2]);
    const bigger = checkPartIdentity({ parts: [part("base", "base", box([20, 10, 2]))], assemblyMesh: { stl: stl(whole) } });
    expect(bigger.containment.status).toBe("FAIL");
    const displaced = checkPartIdentity({ parts: [part("base", "base", box([2, 2, 2], [50, 0, 0]))], assemblyMesh: { stl: stl(whole) } });
    expect(displaced.containment.status).toBe("FAIL");
  });

  test("a contained, distinct part can pass both checks with an explicitly limited claim", () => {
    const whole = box([10, 10, 2]);
    const evidence = checkPartIdentity({ parts: [part("base", "base", box([4, 4, 2], [1, 1, 0]))], assemblyMesh: { stl: stl(whole) } });
    expect(evidence.distinctness.status).toBe("NOT_RUN");
    expect(evidence.containment.status).toBe("PASS");
    expect(evidence.status).toBe("NOT_RUN");
  });

  test("a single part inside a larger assembly passes identity only as a containment claim", () => {
    const whole = box([10, 10, 2]);
    const evidence = checkPartIdentity({
      parts: [part("base", "base", box([4, 4, 2], [1, 1, 0])), part("lid", "lid", box([4, 4, 2], [5, 5, 0]))],
      assemblyMesh: { stl: stl(whole) },
    });
    expect(evidence.status).toBe("PASS");
    expect(evidence.reason).toContain("not measured");
  });

  test("a denser part inside the envelope is not mistaken for the whole assembly", () => {
    const whole = box([10, 10, 2]);
    const dense = [...box([2, 2, 2], [1, 1, 0]), ...box([2, 2, 2], [5, 1, 0])];
    const evidence = checkPartIdentity({
      parts: [part("base", "base", dense), part("lid", "lid", box([2, 2, 2], [7, 7, 0]))],
      assemblyMesh: { stl: stl(whole) },
    });
    expect(evidence.containment.status).toBe("PASS");
  });

  test("duplicate part IDs and missing content hashes are rejected", () => {
    expect(() => checkPartIdentity({ parts: [part("base", "base", box([1, 1, 1])), part("base", "lid", box([2, 2, 2]))] })).toThrow("unique");
    const broken = { ...part("base", "base", box([1, 1, 1])), sha256: "" };
    expect(() => checkPartIdentity({ parts: [broken] })).toThrow("content hash");
  });

  test("an invalid or empty mesh is an error, not a passing part", () => {
    expect(() => checkPartIdentity({ parts: [{ ...part("base", "base", box([1, 1, 1])), stl: Buffer.alloc(10) }] })).toThrow("Invalid binary STL");
    expect(() => checkPartIdentity({ parts: [{ ...part("base", "base", box([1, 1, 1])), stl: Buffer.alloc(84) }] })).toThrow("triangle table");
  });
});
