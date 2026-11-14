import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { boxStl } from "../geometry/__tests__/solids";
import { validateAssemblySpec } from "./assembly-spec";
import { verifyAnalyticRigidSweep } from "./source-rigid-sweep";

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const asPart = (id: string, stl: Buffer) => ({
  partId: id, stl, sha256: createHash("sha256").update(stl).digest("hex"),
  triangleCount: stl.readUInt32LE(80), diagnostics: "",
});
const arm = asPart("arm", boxStl([4,-0.4,-0.4],[5,0.4,0.4]));

function fixture(base: Buffer) {
  const input = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "obstacle", name: "Obstacle", selector: "obstacle", source: "generated", material: null },
      { id: "arm", name: "Moving arm", selector: "arm", source: "generated", material: null },
    ],
    instances: [
      { id: "obstacle-instance", partId: "obstacle", subassemblyId: null, transform: identity },
      { id: "arm-instance", partId: "arm", subassemblyId: null, transform: identity },
    ],
    subassemblies: [], connections: [], groundedInstanceId: "obstacle-instance",
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const spec = validateAssemblySpec(input);
  if (!spec.success) throw new Error(spec.error.message);
  return {
    spec: spec.data,
    parts: [asPart("obstacle", base), arm],
    movingInstanceId: "arm-instance",
    axis: { origin: [0,0,0] as [number,number,number],
      direction: [0,0,1] as [number,number,number] },
    anglesDeg: [-45, 0, 45],
  };
}

describe("A06 bounded analytic rigid-sweep collision evidence", () => {
  test("proves every angle interval clear only with padded midpoint AABB separation", () => {
    const distant = boxStl([60,60,-1],[62,62,1]);
    const result = verifyAnalyticRigidSweep(fixture(distant));
    expect(result.status).toBe("PASS");
    expect(result.certifiedIntervals).toBe(2);
    expect(result.unresolvedIntervals).toEqual([]);
    expect(result.maximumUnresolvedGapDeg).toBe(0);
    expect(result.initialMaximumAngleGapDeg).toBe(45);
    expect(result.evaluatedAnglesDeg).toEqual([-45,0,45]);
    expect(result.movingPartSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.coverage).toContain("analytic rigid");
    expect(result.coverage).toContain("NOT VERIFIED");
  });

  test("finds a real hidden obstruction at 22.5 degrees despite clear -45/0/+45 source reference samples", () => {
    const hidden = boxStl([3.95,1.50,-0.4],[4.40,2.00,0.4]);
    const result = verifyAnalyticRigidSweep(fixture(hidden));
    expect(result.status).toBe("FAIL");
    expect(result.collisionAt).not.toBeNull();
    expect(result.collisionAt?.angleDeg).toBeCloseTo(22.5,6);
    expect(result.collisionAt?.obstacleInstanceId).toBe("obstacle-instance");
    expect(result.collisionAt !== null && ["INTERSECT","CONTAINED"].includes(result.collisionAt.collision)).toBe(true);
    expect(result.collisionAt?.movingMeshSha256).toBe(arm.sha256);
    expect(result.evaluatedAnglesDeg).toContain(22.5);
    expect(result.reason).toContain("actual STL collision");
  });

  test("budget/depth exhaustion never upgrades an ambiguous angular interval to clear", () => {
    const nearby = boxStl([2.8,1.5,-0.2],[3.1,1.8,0.2]);
    const result = verifyAnalyticRigidSweep({ ...fixture(nearby), maxDepth:0 });
    expect(result.status).toBe("NOT_RUN");
    expect(result.collisionAt).toBeNull();
    expect(result.maximumUnresolvedGapDeg).toBeGreaterThan(0);
    expect(result.unresolvedIntervals.length).toBeGreaterThan(0);
    expect(result.unresolvedIntervals[0].reason).toContain("maximum subdivision");
    const scarce = verifyAnalyticRigidSweep({ ...fixture(nearby), maxEvaluations:3, maxDepth:9 });
    expect(scarce.status).toBe("NOT_RUN");
    expect(scarce.reason).toContain("budget");
    expect(scarce.evaluatedAnglesDeg).toHaveLength(3);
  });

  test("bad sampling, degenerate axis, missing purchased mesh and abort all fail closed", () => {
    const good = fixture(boxStl([60,60,-1],[62,62,1]));
    expect(() => verifyAnalyticRigidSweep({ ...good, anglesDeg:[-45,0,0] })).toThrow("monotonic");
    expect(() => verifyAnalyticRigidSweep({ ...good, axis:{origin:[0,0,0],direction:[0,0,0]} })).toThrow("rotation axis");
    expect(() => verifyAnalyticRigidSweep({ ...good, maxPairTests:2_000_001 })).toThrow("triangle-pair");
    const purchased = structuredClone(good.spec);
    purchased.parts[0].source = "purchased";
    expect(() => verifyAnalyticRigidSweep({ ...good, spec:purchased })).toThrow("Incomplete generated assembly");
    const ac = new AbortController();ac.abort();
    const aborted=verifyAnalyticRigidSweep({ ...good,signal:ac.signal });
    expect(aborted.status).toBe("NOT_RUN");
  });
});
