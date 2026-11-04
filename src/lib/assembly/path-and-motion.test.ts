import { describe, expect, test } from "bun:test";
import {
  checkDisassemblyPath,
  checkKinematics,
  checkMotionRange,
  multiplyMatrices,
  rotationAboutAxis,
  translationMatrix,
} from "./path-and-motion";
import { transformPoint } from "../geometry/mesh-collision";
import { boxStl, mergeStl, tubeStl } from "../geometry/__tests__/solids";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * A hub with a radial arm, a matching shaft, and a post at 180°.
 * At 0° the arm points away from the post; rotating half a turn drives it in.
 *
 * Both parts are two separate closed shells. Their bounds must not overlap:
 * containment evidence refuses meshes with overlapping shell bounds and answers
 * `UNKNOWN`, which these path/motion checks must downgrade to NOT_RUN (see the
 * dedicated negative test below). The arm therefore starts just outside the
 * hub's outer radius; these tests sample collision, not part connectivity.
 */
function rotorFixture() {
  const fixed = mergeStl(
    tubeStl({ outerRadius: 3, innerRadius: 2.5, height: 4, segments: 48 }),
    boxStl([-10, -1, 0], [-8, 1, 4]),
  );
  const moving = mergeStl(
    tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 4, segments: 48 }),
    boxStl([5.1, -1, 0], [10, 1, 4]),
  );
  return { fixed, moving };
}

const spec = (overrides: { range?: { min: number; max: number; unit: string } | null; allowedContact?: string[] } = {}) => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [
    { id: "fixed", name: "Fixed", selector: "fixed", source: "generated", material: null },
    { id: "moving", name: "Moving", selector: "moving", source: "generated", material: null },
  ],
  instances: [
    { id: "fixed-instance", partId: "fixed", subassemblyId: null, transform: IDENTITY },
    { id: "moving-instance", partId: "moving", subassemblyId: null, transform: IDENTITY },
  ],
  subassemblies: [], groundedInstanceId: "fixed-instance",
  connections: [{
    id: "joint", type: "revolute", a: "fixed-instance", b: "moving-instance",
    frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
    range: overrides.range === undefined ? { min: -45, max: 45, unit: "deg" } : overrides.range,
    pitchMm: null, ratio: null, allowedContact: overrides.allowedContact ?? [],
  }],
  motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
});

describe("transform helpers", () => {
  test("a quarter turn about Z maps +X onto +Y", () => {
    const point = transformPoint(rotationAboutAxis([0, 0, 0], [0, 0, 1], Math.PI / 2), [1, 0, 0]);
    expect(point[0]).toBeCloseTo(0, 9);
    expect(point[1]).toBeCloseTo(1, 9);
    expect(point[2]).toBeCloseTo(0, 9);
  });

  test("rotation about an offset axis keeps the axis fixed", () => {
    const matrix = rotationAboutAxis([5, 5, 0], [0, 0, 1], 1.234);
    const point = transformPoint(matrix, [5, 5, 3]);
    expect(point[0]).toBeCloseTo(5, 9);
    expect(point[1]).toBeCloseTo(5, 9);
    expect(point[2]).toBeCloseTo(3, 9);
  });

  test("the product applies the right-hand matrix first", () => {
    const combined = multiplyMatrices(translationMatrix([10, 0, 0]), translationMatrix([0, 2, 0]));
    const point = transformPoint(combined, [0, 0, 0]);
    expect(point).toEqual([10, 2, 0]);
  });

  test("a zero-length axis is refused", () => {
    expect(() => rotationAboutAxis([0, 0, 0], [0, 0, 0], 1)).toThrow(/non-zero/);
  });
});

describe("disassembly path", () => {
  const { fixed, moving } = rotorFixture();

  test("a hub can slide off its shaft", () => {
    const result = checkDisassemblyPath({ spec: spec(), meshes: { fixed, moving }, connectionId: "joint" });
    expect(result.status).toBe("PASS");
    expect(result.clearDirection).not.toBeNull();
    expect(result.distanceMm).toBeGreaterThan(0);
    expect(result.stepMm).toBeCloseTo(result.distanceMm / (result.steps - 1), 9);
    // Coverage is reported, because a pass without it says nothing.
    expect(result.coverage).toContain("mm along");
    expect(result.posesEvaluated).toBeGreaterThan(1);
  });

  test("a cap over the exit blocks that direction, and a cap on both ends blocks the path", () => {
    // One cap only blocks +Z; the part can still come out the other way, which is
    // the correct answer for a disassembly path.
    const oneCap = {
      ...spec(),
      parts: [...spec().parts, { id: "cap", name: "Cap", selector: "cap", source: "generated", material: null }],
      instances: [...spec().instances, { id: "cap-instance", partId: "cap", subassemblyId: null, transform: IDENTITY }],
    };
    const oneSided = checkDisassemblyPath({
      spec: oneCap, connectionId: "joint",
      meshes: { fixed, moving, cap: boxStl([-20, -20, 4.5], [20, 20, 8]) },
    });
    expect(oneSided.status).toBe("PASS");
    expect(oneSided.clearDirection).toBe(-1);

    const bothCaps = {
      ...oneCap,
      parts: [...oneCap.parts, { id: "cap2", name: "Cap 2", selector: "cap2", source: "generated", material: null }],
      instances: [...oneCap.instances, { id: "cap2-instance", partId: "cap2", subassemblyId: null, transform: IDENTITY }],
    };
    const result = checkDisassemblyPath({
      spec: bothCaps, connectionId: "joint",
      meshes: { fixed, moving, cap: boxStl([-20, -20, 4.5], [20, 20, 8]), cap2: boxStl([-20, -20, -8], [20, 20, -4.5]) },
    });
    expect(result.status).toBe("FAIL");
    expect(result.clearDirection).toBeNull();
    expect(result.blockedAt).not.toBeNull();
    expect(result.blockedAt!.worst).toBe("BLOCKED");
    expect(result.reason).toContain("moving-instance");
    expect(result.blockedAt!.blocking[0].status).toBe("INTERSECT");
  });

  test("a missing mesh is not run, not a pass", () => {
    const result = checkDisassemblyPath({ spec: spec(), meshes: { fixed }, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("no mesh");
  });

  test("a purchased part has no mesh to check", () => {
    const purchased = spec();
    purchased.parts[1].source = "purchased";
    const result = checkDisassemblyPath({ spec: purchased, meshes: { fixed, moving }, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("purchased");
  });

  test("an unknown connection is an error", () => {
    expect(checkDisassemblyPath({ spec: spec(), meshes: { fixed, moving }, connectionId: "missing" }).status).toBe("ERROR");
  });

  test("a non-revolute connection has no axis to slide along", () => {
    const sliding = spec();
    sliding.connections[0].type = "prismatic";
    expect(checkDisassemblyPath({ spec: sliding, meshes: { fixed, moving }, connectionId: "joint" }).status).toBe("NOT_RUN");
  });

  test("a declared contact is tolerated and counted, not silently ignored", () => {
    // The arm sweeps into the post at half a turn; declaring both as contacts
    // must show up in the result rather than quietly turning the block into a pass.
    const capped = {
      ...spec({ allowedContact: ["moving", "cap"] }),
      parts: [...spec().parts, { id: "cap", name: "Cap", selector: "cap", source: "generated", material: null }],
      instances: [...spec().instances, { id: "cap-instance", partId: "cap", subassemblyId: null, transform: IDENTITY }],
    };
    const result = checkDisassemblyPath({
      spec: capped, connectionId: "joint",
      meshes: { fixed, moving, cap: boxStl([-20, -20, 4.5], [20, 20, 8]) },
    });
    expect(result.status).toBe("PASS");
    expect(result.toleratedContacts).toBeGreaterThan(0);
    expect(result.reason).toContain("tolerated");
  });
});

describe("motion range", () => {
  const { fixed, moving } = rotorFixture();
  const meshes = { fixed, moving };

  test("a quarter turn that misses the post passes, with the sampled angles reported", () => {
    const result = checkMotionRange({ spec: spec(), meshes, connectionId: "joint" });
    expect(result.status).toBe("PASS");
    expect(result.rangeDeg).toEqual({ min: -45, max: 45 });
    expect(result.stepDeg).toBeCloseTo(90 / (result.steps - 1), 9);
    expect(result.coverage).toContain("-45° to 45°");
  });

  test("turning far enough to reach the post fails at the angle where it happens", () => {
    const result = checkMotionRange({ spec: spec({ range: { min: -180, max: 180, unit: "deg" } }), meshes, connectionId: "joint", steps: 37 });
    expect(result.status).toBe("FAIL");
    expect(result.blockedAt).not.toBeNull();
    // The post sits at 180°, so the block must happen in the second half of the sweep.
    expect(Math.abs(result.blockedAt!.angleDeg)).toBeGreaterThan(120);
    expect(result.reason).toContain("interferes");
  });

  test("a joint with no range has nothing to sample", () => {
    const result = checkMotionRange({ spec: spec({ range: null }), meshes, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("no motion range");
  });

  test("a linear range is not an angle and is not sampled as one", () => {
    const result = checkMotionRange({ spec: spec({ range: { min: 0, max: 10, unit: "mm" } }), meshes, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("not an angle");
  });

  test("both checks run from one call", () => {
    const result = checkKinematics({ spec: spec(), meshes, connectionId: "joint" });
    expect(result.path.status).toBe("PASS");
    expect(result.motion.status).toBe("PASS");
    expect(result.motion.unknowns.length).toBeGreaterThan(0);
  });

  test("a wide range is not truncated to the declared one", () => {
    // The declared ±45° passes; the same geometry fails at ±180°. A check that
    // ignored the declared range would report the same answer for both.
    const narrow = checkMotionRange({ spec: spec(), meshes, connectionId: "joint" });
    const wide = checkMotionRange({ spec: spec({ range: { min: -180, max: 180, unit: "deg" } }), meshes, connectionId: "joint" });
    expect(narrow.status).toBe("PASS");
    expect(wide.status).toBe("FAIL");
  });
});

describe("undecided collision evidence is never a pass", () => {
  // A hub whose arm overlaps the hub's outer bounds: two closed shells with
  // overlapping bounds. Containment cannot establish separation for this mesh,
  // so each sampled pose is UNDECIDED. A check that treated UNKNOWN as
  // clearance would wrongly report PASS here.
  const overlappingShells = mergeStl(
    tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 4, segments: 48 }),
    boxStl([4, -1, 0], [10, 1, 4]),
  );
  const { fixed } = rotorFixture();
  const meshes = { fixed, moving: overlappingShells };

  test("disassembly path is NOT_RUN when containment cannot be decided", () => {
    const result = checkDisassemblyPath({ spec: spec(), meshes, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("could not be decided");
  });

  test("motion range is NOT_RUN when containment cannot be decided", () => {
    const result = checkMotionRange({ spec: spec(), meshes, connectionId: "joint" });
    expect(result.status).toBe("NOT_RUN");
    expect(result.reason).toContain("could not be decided");
  });
});

describe("sampling inputs cannot bypass geometry checks", () => {
  const meshes = rotorFixture();
  for (const steps of [NaN, Infinity, -Infinity, 0, 1, 2.5, 4097]) {
    test(`invalid sample count ${steps} produces ERROR, never empty PASS`, () => {
      const input = { spec: spec(), meshes, connectionId: "joint", steps };
      // Infinity must be refused before entering the loop.
      expect(checkDisassemblyPath(input).status).toBe("ERROR");
      expect(checkMotionRange(input).status).toBe("ERROR");
    });
  }
  for (const options of [{epsilonMm:NaN}, {epsilonMm:-1}, {maxPairTests:NaN}, {maxPairTests:0}, {maxPairTests:2.5}]) {
    test(`invalid numeric controls ${JSON.stringify(options)} are refused`, () => {
      const input = { spec: spec(), meshes, connectionId: "joint", ...options };
      expect(checkDisassemblyPath(input).status).toBe("ERROR");
      expect(checkMotionRange(input).status).toBe("ERROR");
    });
  }
});

test("allowed contact cannot excuse an undecided collision budget", () => {
  const input = { spec: spec({ allowedContact: ["fixed", "moving"] }), meshes: rotorFixture(), connectionId:"joint", maxPairTests:1 };
  expect(checkMotionRange(input).status).toBe("NOT_RUN");
  expect(checkDisassemblyPath(input).status).toBe("NOT_RUN");
});
