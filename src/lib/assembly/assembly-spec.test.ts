import { describe, expect, test } from "bun:test";
import { validateAssemblySpec } from "./assembly-spec";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ref = { origin: [0, 0, 0], direction: [0, 0, 1] };
const joint = (id: string, a: string, b: string) => ({
  id, type: "revolute", a, b, frameA: ref, frameB: ref,
  range: { min: 0, max: 360, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
});
const fixture = () => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [
    { id: "block", name: "Block", selector: "block", source: "generated", material: null },
    { id: "crank", name: "Crank", selector: "crank", source: "generated", material: null },
    { id: "rod", name: "Rod", selector: "rod", source: "generated", material: null },
    { id: "piston", name: "Piston", selector: "piston", source: "generated", material: null },
  ],
  instances: ["block", "crank", "rod", "piston"].map((x) => ({ id: x, partId: x, subassemblyId: "engine", transform: [...identity] })),
  subassemblies: [{ id: "engine", name: "Engine", parentId: null as string | null }],
  connections: [joint("main", "block", "crank"), joint("big_end", "crank", "rod"), joint("wrist", "rod", "piston"), joint("guide", "piston", "block")],
  groundedInstanceId: "block", motions: [{ id: "drive", inputConnectionId: "main", range: { min: 0, max: 360, unit: "deg" } }],
  operations: [], manufacturing: null, assumptions: [], unknowns: ["Manufacturing process is unknown"],
});

describe("assembly specification", () => {
  test("accepts a closed-loop mechanism without treating its contract as geometric proof", () => {
    const result = validateAssemblySpec(fixture());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.manufacturing).toBeNull();
  });
  test("allows repeated instances while preserving a single part definition", () => {
    const value = fixture();
    value.instances.push({ id: "piston2", partId: "piston", subassemblyId: "engine", transform: [...identity] });
    expect(validateAssemblySpec(value).success).toBe(true);
  });
  test("rejects duplicate IDs and references to missing instances", () => {
    const value = fixture();
    value.instances.push({ ...value.instances[0] });
    value.connections[0].b = "missing";
    const result = validateAssemblySpec(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("Duplicate"))).toBe(true);
      expect(result.error.issues.some((i) => i.message.includes("Unknown instance"))).toBe(true);
    }
  });
  test("rejects cyclic subassemblies, but not closed-loop joints", () => {
    const value = fixture();
    value.subassemblies[0].parentId = "engine";
    expect(validateAssemblySpec(value).success).toBe(false);
  });
  test("rejects scaling, reflection, malformed transforms, and zero axes", () => {
    for (const matrix of [
      [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    ]) {
      const value = fixture();
      value.instances[0].transform = matrix;
      expect(validateAssemblySpec(value).success).toBe(false);
    }
    const value = fixture();
    value.connections[0].frameA = { origin: [0, 0, 0], direction: [0, 0, 0] };
    expect(validateAssemblySpec(value).success).toBe(false);
  });
  test("rejects executable selectors and inconsistent bounds", () => {
    const value = fixture();
    value.parts[0].selector = 'evil();';
    value.motions[0].range.min = 361;
    expect(validateAssemblySpec(value).success).toBe(false);
  });
});
