import { describe, expect, test } from "bun:test";
import { checkMeshSeparation } from "./mesh-separation-check";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function triangle() {
  const mesh = Buffer.alloc(134);
  mesh.writeUInt32LE(1, 80);
  [[0, 0, 0], [1, 0, 0], [0, 1, 1]].forEach((p, i) => p.forEach((v, k) => mesh.writeFloatLE(v, 96 + 12 * i + 4 * k)));
  return mesh;
}
function example() {
  const transform = [...identity]; transform[3] = 3;
  return {
    spec: {
      schemaVersion: 1, units: "mm", coordinateSystem: "right-handed", parts: [{ id: "p", name: "Part", selector: "p", source: "generated", material: null }],
      instances: [{ id: "a", partId: "p", subassemblyId: null, transform: [...identity] }, { id: "b", partId: "p", subassemblyId: null, transform }],
      subassemblies: [], connections: [], groundedInstanceId: "a", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
    },
    instanceA: "a", instanceB: "b", meshes: { p: triangle() }, minimumGapMm: 1, numericalMarginMm: 0.01,
  };
}

describe("actual STL bounding box separation", () => {
  test("proves a conservative distance bound using each instance pose", () => {
    const result = checkMeshSeparation(example());
    expect(result.status).toBe("PASS");
    expect(result).toHaveProperty("lowerBoundMm", 2);
    expect(result).toHaveProperty("meshAHash");
  });
  test("overlapping boxes and an excessive threshold are inconclusive", () => {
    const input = example();
    input.spec.instances[1].transform[3] = 0.5;
    expect(checkMeshSeparation(input).status).toBe("NOT_RUN");
    input.spec.instances[1].transform[3] = 3;
    input.minimumGapMm = 2;
    expect(checkMeshSeparation(input).status).toBe("NOT_RUN");
  });
  test("missing and malformed meshes never pass", () => {
    const input = example();
    expect(checkMeshSeparation({ ...input, meshes: {} }).status).toBe("NOT_RUN");
    input.meshes.p.writeFloatLE(NaN, 96);
    expect(checkMeshSeparation(input).status).toBe("ERROR");
  });
});
