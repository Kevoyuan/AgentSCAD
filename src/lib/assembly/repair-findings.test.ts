import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { assertRepairPreservesAssembly, buildAssemblyRepairPrompt, collectAssemblyFindings } from "./repair-findings";
import { prepareAssembly } from "./prepare-assembly";
import { prismStl } from "../geometry/__tests__/prism";
import { boxStl, mergeStl, tubeStl } from "../geometry/__tests__/solids";

const POSE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Renders pre-built meshes as if OpenSCAD had produced them. */
const render = (meshes: Record<string, Buffer>) => async () => ({
  parts: Object.entries(meshes).map(([partId, stl]) => ({
    partId, stl, sha256: createHash("sha256").update(stl).digest("hex"),
    triangleCount: stl.readUInt32LE(80), diagnostics: "",
  })),
  purchasedPartIds: [],
});

/** A 3.2 mm-radius bore around a 3 mm-radius shaft: 0.4 mm diametral clearance. */
function boreAndShaft(clearanceBand = { min: 0.1, max: 0.3 }) {
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "bore", name: "Bore", selector: "bore", source: "generated", material: null },
      { id: "shaft", name: "Shaft", selector: "shaft", source: "generated", material: null },
    ],
    instances: [
      { id: "bore-instance", partId: "bore", subassemblyId: null, transform: POSE },
      { id: "shaft-instance", partId: "shaft", subassemblyId: null, transform: POSE },
    ],
    subassemblies: [], groundedInstanceId: "bore-instance",
    connections: [{
      id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance",
      frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
      range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const meshes = {
    bore: tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
    shaft: prismStl({ radius: 3, height: 12, segments: 64, z0: -1 }),
  };
  const fitRequirements = [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: clearanceBand }];
  return { spec, meshes, fitRequirements };
}

/**
 * A hub with a radial arm and a post at 180°, so a wide range drives the arm into
 * the post. The two shells in each part have disjoint bounds; overlapping shell
 * bounds make containment UNKNOWN and the motion evidence NOT_RUN, so this
 * fixture deliberately keeps the arm clear of the hub's outer radius.
 */
function rotor(range: { min: number; max: number; unit: string }) {
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "fixed", name: "Fixed", selector: "fixed", source: "generated", material: null },
      { id: "moving", name: "Moving", selector: "moving", source: "generated", material: null },
    ],
    instances: [
      { id: "fixed-instance", partId: "fixed", subassemblyId: null, transform: POSE },
      { id: "moving-instance", partId: "moving", subassemblyId: null, transform: POSE },
    ],
    subassemblies: [], groundedInstanceId: "fixed-instance",
    connections: [{
      id: "joint", type: "revolute", a: "fixed-instance", b: "moving-instance",
      frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
      range, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const meshes = {
    fixed: mergeStl(tubeStl({ outerRadius: 3, innerRadius: 2.5, height: 4, segments: 48 }), boxStl([-10, -1, 0], [-8, 1, 4])),
    moving: mergeStl(tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 4, segments: 48 }), boxStl([5.1, -1, 0], [10, 1, 4])),
  };
  return { spec, meshes };
}

describe("collecting findings", () => {
  test("a satisfied assembly produces nothing to repair", async () => {
    const fixture = boreAndShaft({ min: 0.35, max: 0.45 });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      fitRequirements: fixture.fitRequirements,
    });
    expect(prepared.manifest.evidence.assembly.status).toBe("PASS");
    expect(prepared.kinematics).toBeNull();
    expect(collectAssemblyFindings({
      manifest: prepared.manifest, fitRequirements: fixture.fitRequirements, kinematics: prepared.kinematics,
    })).toEqual([]);
  });

  test("a fit failure carries the measured range, the required range and the connection", async () => {
    const fixture = boreAndShaft({ min: 0.1, max: 0.3 });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      fitRequirements: fixture.fitRequirements,
    });
    const findings = collectAssemblyFindings({
      manifest: prepared.manifest, fitRequirements: fixture.fitRequirements, kinematics: prepared.kinematics,
    });
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.kind).toBe("fit");
    expect(finding.layer).toBe("assembly");
    expect(finding.connectionId).toBe("joint");
    // The numbers come from the measurement, not from the requirement, and are
    // rounded to a readable precision rather than printed as raw floats.
    expect(finding.measured).toBe("0.392–0.407 mm");
    expect(finding.required).toBe("0.100–0.300 mm");
    expect(finding.instanceIds).toEqual(["bore-instance"]);
    expect(finding.message).toContain("outside the required band");
    // Nothing was measured for these, so nothing is claimed about them.
    expect(finding.atMm).toBeNull();
    expect(finding.atDeg).toBeNull();
  });

  test("a layer that was never measured produces no finding", async () => {
    const fixture = boreAndShaft();
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
    });
    expect(prepared.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(collectAssemblyFindings({ manifest: prepared.manifest, kinematics: null })).toEqual([]);
  });

  test("an unconfirmed contract never hides a failure, but marks the band as provisional", async () => {
    const fixture = boreAndShaft({ min: 0.1, max: 0.3 });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      fitRequirements: fixture.fitRequirements,
      contractGate: { evidenceCurrent: false, reason: "The contract is not confirmed." },
    });
    // The gate is one-way: it withholds a PASS, it never softens a FAIL. A part
    // that measurably does not fit stays failed whatever the contract says.
    expect(prepared.manifest.fits[0].status).toBe("FAIL");
    expect(prepared.manifest.fits[0].measuredStatus).toBe("FAIL");
    const findings = collectAssemblyFindings({
      manifest: prepared.manifest, fitRequirements: fixture.fitRequirements, kinematics: null,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].measured).toBe("0.392–0.407 mm");
    // What the gate does change is how the band is described: it is not the
    // user's requirement until the user confirms it.
    expect(findings[0].message).toContain("not from a confirmed contract");

    // The same gate on a measurement that passed withholds the verdict, and a
    // withheld verdict is not a failure to repair.
    const passing = boreAndShaft({ min: 0.35, max: 0.45 });
    const withheld = await prepareAssembly({
      scadSource: "cube(1);", spec: passing.spec, render: render(passing.meshes),
      fitRequirements: passing.fitRequirements,
      contractGate: { evidenceCurrent: false, reason: "The contract is not confirmed." },
    });
    expect(withheld.manifest.fits[0].status).toBe("NOT_RUN");
    expect(withheld.manifest.fits[0].measuredStatus).toBe("PASS");
    expect(collectAssemblyFindings({
      manifest: withheld.manifest, fitRequirements: passing.fitRequirements, kinematics: null,
    })).toEqual([]);
  });

  test("a blocked rotation names both parts and the angle it stopped at", async () => {
    const fixture = rotor({ min: -180, max: 180, unit: "deg" });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      kinematics: { connectionId: "joint", motionSteps: 37 },
    });
    expect(prepared.manifest.evidence.motion.status).toBe("FAIL");
    const motion = collectAssemblyFindings({ manifest: prepared.manifest, kinematics: prepared.kinematics })
      .find((finding) => finding.kind === "motion")!;
    expect(motion.layer).toBe("motion");
    expect(motion.connectionId).toBe("joint");
    expect(motion.instanceIds).toEqual(["moving-instance", "fixed-instance"]);
    // The sweep starts at one end of the declared range, so the post is hit at
    // the far end of the turn rather than near the assembled pose.
    expect(Math.abs(motion.atDeg!)).toBeGreaterThan(120);
    expect(motion.atDeg).toBeGreaterThanOrEqual(-180);
    expect(motion.atDeg).toBeLessThanOrEqual(180);
    expect(motion.measured).toBe(`blocked at ${motion.atDeg!.toFixed(2)}°`);
    expect(motion.required).toBe("-180.00–180.00 deg");
    expect(motion.message).toContain("interferes with");
  });

  test("the narrow range that passes produces no motion finding", async () => {
    const fixture = rotor({ min: -45, max: 45, unit: "deg" });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      kinematics: { connectionId: "joint" },
    });
    expect(prepared.manifest.evidence.motion.status).toBe("PASS");
    expect(collectAssemblyFindings({ manifest: prepared.manifest, kinematics: prepared.kinematics })).toEqual([]);
  });

  test("a blocked path reports the distance at which it stopped", async () => {
    const fixture = rotor({ min: -45, max: 45, unit: "deg" });
    // Caps above and below close both directions the moving part could leave in.
    const capped = {
      ...fixture.spec,
      parts: [...fixture.spec.parts, { id: "cap", name: "Cap", selector: "cap", source: "generated", material: null }],
      instances: [
        ...fixture.spec.instances,
        { id: "cap-top", partId: "cap", subassemblyId: null, transform: POSE },
        { id: "cap-bottom", partId: "cap", subassemblyId: null, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -10.2, 0, 0, 0, 1] },
      ],
    };
    const meshes = { ...fixture.meshes, cap: boxStl([-20, -20, 4.2], [20, 20, 6]) };
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: capped, render: render(meshes),
      kinematics: { connectionId: "joint", pathSteps: 16 },
    });
    expect(prepared.manifest.evidence.assembly.status).toBe("FAIL");
    const path = collectAssemblyFindings({ manifest: prepared.manifest, kinematics: prepared.kinematics })
      .find((finding) => finding.kind === "path")!;
    expect(path.atMm).toBeGreaterThan(0);
    expect(path.measured).toBe(`blocked at ${path.atMm!.toFixed(3)} mm along the axis`);
    expect(path.required).toContain("unobstructed straight path");
    expect(path.message).toContain("interferes with");
  });
});

describe("the repair prompt", () => {
  test("states the invariants and repeats the numbers the model must hit", async () => {
    const fixture = boreAndShaft({ min: 0.1, max: 0.3 });
    const prepared = await prepareAssembly({
      scadSource: "cube(1);", spec: fixture.spec, render: render(fixture.meshes),
      fitRequirements: fixture.fitRequirements,
    });
    const findings = collectAssemblyFindings({
      manifest: prepared.manifest, fitRequirements: fixture.fitRequirements, kinematics: null,
    });
    const prompt = buildAssemblyRepairPrompt({
      originalRequest: "a hinge that turns freely",
      spec: fixture.spec as never,
      findings,
      currentScad: "difference() { cube(10); }",
    });
    expect(prompt).toContain("a hinge that turns freely");
    expect(prompt).toContain("measured: 0.392–0.407 mm");
    expect(prompt).toContain("required: 0.100–0.300 mm");
    expect(prompt).toContain("connection: joint");
    expect(prompt).toContain("instances: bore-instance");
    expect(prompt).toContain("```scad");
    // The invariants are stated before the reply is written, not after it is rejected.
    expect(prompt).toContain("Keep every part, instance and connection");
    expect(prompt).toContain("Do not change the declared motion range to a smaller one.");
    expect(prompt).toContain("Do not change which instance carries the bore.");
    expect(prompt).toContain("Do not change the requirement.");
    expect(prompt).toContain("Return the complete corrected SCAD source");
  });

  test("says so plainly when there is nothing measured to repair", () => {
    const prompt = buildAssemblyRepairPrompt({
      originalRequest: "a hinge", spec: { parts: [], instances: [], connections: [] } as never,
      findings: [], currentScad: "cube(1);",
    });
    expect(prompt).toContain("(no measured failures)");
    expect(prompt).toContain("connections: (none)");
  });
});

describe("guarding a repair against a weakened declaration", () => {
  const base = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "leaf", name: "Leaf", selector: "leaf", source: "generated", material: null },
      { id: "pin", name: "Pin", selector: "pin", source: "generated", material: null },
    ],
    instances: [
      { id: "leaf-a", partId: "leaf", subassemblyId: null, transform: POSE },
      { id: "leaf-b", partId: "leaf", subassemblyId: null, transform: POSE },
      { id: "pin-1", partId: "pin", subassemblyId: null, transform: POSE },
    ],
    subassemblies: [], groundedInstanceId: "leaf-a",
    connections: [{
      id: "hinge", type: "revolute", a: "leaf-a", b: "leaf-b",
      frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
      range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null,
      boreInstanceId: "leaf-b", allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const clone = () => JSON.parse(JSON.stringify(base));
  const codes = (result: { violations: { code: string }[] }) => result.violations.map((violation) => violation.code);

  test("a pure geometry change is accepted", () => {
    const result = assertRepairPreservesAssembly({ before: base, after: clone() });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("removing a part or an instance is refused", () => {
    const noPart = clone();
    noPart.parts = noPart.parts.filter((part: { id: string }) => part.id !== "pin");
    noPart.instances = noPart.instances.filter((instance: { partId: string }) => instance.partId !== "pin");
    expect(codes(assertRepairPreservesAssembly({ before: base, after: noPart }))).toEqual(["part-removed", "instance-removed"]);

    const noInstance = clone();
    noInstance.instances = noInstance.instances.filter((instance: { id: string }) => instance.id !== "pin-1");
    expect(codes(assertRepairPreservesAssembly({ before: base, after: noInstance }))).toEqual(["instance-removed"]);
  });

  test("dropping the joint is refused", () => {
    const result = assertRepairPreservesAssembly({ before: base, after: { ...clone(), connections: [] } });
    expect(codes(result)).toEqual(["connection-removed"]);
  });

  test("changing which instances a joint joins is refused", () => {
    const swapped = clone();
    swapped.connections[0].a = "leaf-b";
    swapped.connections[0].b = "leaf-a";
    expect(codes(assertRepairPreservesAssembly({ before: base, after: swapped }))).toEqual(["connection-changed"]);

    const retyped = clone();
    retyped.connections[0].type = "fixed";
    expect(codes(assertRepairPreservesAssembly({ before: base, after: retyped }))).toContain("connection-changed");
  });

  test("shrinking or dropping the declared range is refused", () => {
    const shrunk = clone();
    shrunk.connections[0].range = { min: -30, max: 30, unit: "deg" };
    expect(codes(assertRepairPreservesAssembly({ before: base, after: shrunk }))).toEqual(["range-shrunk"]);

    const dropped = clone();
    dropped.connections[0].range = null;
    expect(codes(assertRepairPreservesAssembly({ before: base, after: dropped }))).toEqual(["range-shrunk"]);

    // A range that only grew is not a weakening.
    const grown = clone();
    grown.connections[0].range = { min: -90, max: 90, unit: "deg" };
    expect(assertRepairPreservesAssembly({ before: base, after: grown }).ok).toBe(true);
  });

  test("moving the bore to the other side is refused", () => {
    const moved = clone();
    moved.connections[0].boreInstanceId = "leaf-a";
    expect(codes(assertRepairPreservesAssembly({ before: base, after: moved }))).toEqual(["bore-changed"]);
  });

  test("every weakening is reported, not just the first", () => {
    const gutted = clone();
    gutted.parts = gutted.parts.filter((part: { id: string }) => part.id !== "pin");
    gutted.instances = gutted.instances.filter((instance: { partId: string }) => instance.partId !== "pin");
    gutted.connections[0].range = { min: -10, max: 10, unit: "deg" };
    gutted.connections[0].boreInstanceId = "leaf-a";
    expect(codes(assertRepairPreservesAssembly({ before: base, after: gutted })))
      .toEqual(["part-removed", "instance-removed", "range-shrunk", "bore-changed"]);
  });

  test("a malformed declaration is invalid rather than silently accepted", () => {
    const broken = assertRepairPreservesAssembly({ before: base, after: { ...clone(), units: "inch" } });
    expect(broken.ok).toBe(false);
    expect(codes(broken)).toEqual(["invalid"]);
    expect(codes(assertRepairPreservesAssembly({ before: { nope: true }, after: base }))).toEqual(["invalid"]);
  });

  test("a declaration left short of the contract's minimum is refused even if it did not shrink", () => {
    const contract = {
      schemaVersion: 1 as const, id: "hinge", revision: 1, requestSha256: "0".repeat(64),
      capturedAt: "2026-10-29T00:00:00.000Z", targetLevel: "digital" as const,
      intent: { kind: "revolute-hinge" as const, summary: "a hinge" },
      requirements: [{
        id: "motion-range-deg", layer: "motion" as const, required: true, applicable: true,
        expected: { kind: "atLeast" as const, min: 90, unit: "deg" },
        provenance: "request" as const, statement: "turn 90 degrees",
      }],
      unknowns: [], assumptions: [],
    };
    // Nothing shrank — the declaration was already ±45 and stayed there.
    const result = assertRepairPreservesAssembly({ before: base, after: clone(), contract });
    expect(codes(result)).toEqual(["requirement-relaxed"]);
    expect(result.violations[0].message).toContain("at least 90 deg");

    const wide = clone();
    wide.connections[0].range = { min: -90, max: 90, unit: "deg" };
    expect(assertRepairPreservesAssembly({ before: base, after: wide, contract }).ok).toBe(true);
  });
});
