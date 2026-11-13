import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { prepareAssembly } from "./prepare-assembly";
import { AssemblySpecSchema } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { prismStl } from "../geometry/__tests__/prism";
import { tubeStl, boxStl, mergeStl } from "../geometry/__tests__/solids";
import { deriveRequirementContract } from "../requirements/extract-requirements";
import { requirementContractHash } from "../requirements/requirement-contract";

const pose = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

test("report binds a contract snapshot without inventing confirmation", async () => {
  const request = "做一个两件式铰链";
  const contract = deriveRequirementContract({ request });
  const hash = requirementContractHash(contract);
  const result = await prepareAssembly({ scadSource: "cube(1);", spec: spec(),
    contractSnapshot: { contract, request }, render: async () => {
      contract.revision = 2;
      return output();
    } });
  expect(result.manifest.contract.binding).toEqual({ sha256: hash, revision: 1,
    requestSha256: contract.requestSha256, requestMatches: true });
  expect(result.manifest.contract.evidenceCurrent).toBeNull();
});

test("a stale contract overrides a caller claiming current evidence", async () => {
  const contract = deriveRequirementContract({ request: "做一个两件式铰链" });
  const result = await prepareAssembly({ scadSource: "cube(1);", spec: spec(),
    contractSnapshot: { contract, request: "做一个三件式铰链" },
    contractGate: { evidenceCurrent: true }, render: async () => output() });
  expect(result.manifest.contract.binding?.requestMatches).toBe(false);
  expect(result.manifest.contract.evidenceCurrent).toBe(false);
  expect(result.manifest.contract.reason).toContain("stale");
  expect(Object.values(result.manifest.evidence).some(item => item.status === "PASS")).toBe(false);
});
const spec = () => ({
  schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
  parts: [
    { id: "leaf", name: "Leaf", selector: "leaf", source: "generated", material: null },
    { id: "pin", name: "Pin", selector: "pin", source: "purchased", material: "steel" },
  ],
  instances: [
    { id: "leaf1", partId: "leaf", subassemblyId: null, transform: pose },
    { id: "leaf2", partId: "leaf", subassemblyId: null, transform: pose },
    { id: "pin1", partId: "pin", subassemblyId: null, transform: pose },
  ], subassemblies: [], connections: [], groundedInstanceId: "leaf1", motions: [], operations: [],
  manufacturing: null, assumptions: [], unknowns: [],
});
/** A valid one-triangle binary STL; the identity check reads real triangle tables. */
const stl = (() => {
  const buffer = Buffer.alloc(134);
  buffer.writeUInt32LE(1, 80);
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, 96 + v * 12 + k * 4)));
  return buffer;
})();
const output = () => ({ parts: [{ partId: "leaf", stl, sha256: createHash("sha256").update(stl).digest("hex"), triangleCount: 1, diagnostics: "" }], purchasedPartIds: ["pin"] });

describe("prepare assembly candidate", () => {
  test("binds source, specification, part artifacts and repeated instances without claiming identity or functionality", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: spec(), render: async () => output() });
    expect(result.parts).toHaveLength(1);
    expect(result.manifest.instances.map((i) => i.partId)).toEqual(["leaf", "leaf", "pin"]);
    expect(result.manifest.parts[1].artifactSha256).toBeNull();
    expect(result.manifest.evidence.identity.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");
    expect(result.manifest.sourceSha256).toHaveLength(64);
    expect(result.manifest.specificationSha256).toHaveLength(64);
  });
  test("rejects incomplete, mismatched, and tampered results", async () => {
    const source = "cube(1);";
    await expect(prepareAssembly({ scadSource: source, spec: spec(), render: async () => ({ parts: [], purchasedPartIds: ["pin"] }) })).rejects.toThrow("Missing generated");
    await expect(prepareAssembly({ scadSource: source, spec: spec(), render: async () => ({ ...output(), purchasedPartIds: [] }) })).rejects.toThrow("Purchased parts");
    await expect(prepareAssembly({ scadSource: source, spec: spec(), render: async () => ({ ...output(), parts: [{ ...output().parts[0], sha256: "bad" }] }) })).rejects.toThrow("hash mismatch");
  });
  test("uses the canonical API specification hash regardless of object key order", async () => {
    const original = spec();
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    const first = await prepareAssembly({ scadSource: "cube(1);", spec: original, render: async () => output() });
    const second = await prepareAssembly({ scadSource: "cube(1);", spec: reversed, render: async () => output() });
    expect(first.manifest.specificationSha256).toBe(assemblySpecificationHash(AssemblySpecSchema.parse(original)));
    expect(second.manifest.specificationSha256).toBe(first.manifest.specificationSha256);
  });
  test("rejects invalid contracts before invoking renderer", async () => {
    let called = false;
    await expect(prepareAssembly({ scadSource: "cube(1);", spec: {}, render: async () => { called = true; return output(); } })).rejects.toThrow("Invalid assembly");
    expect(called).toBe(false);
  });
  test("reports an ignored selector as failed identity evidence instead of two parts", async () => {
    const twoParts = { ...spec(), parts: [
      { id: "leaf", name: "Leaf", selector: "leaf", source: "generated", material: null },
      { id: "pin", name: "Pin", selector: "pin", source: "generated", material: null },
    ], instances: [{ id: "leaf1", partId: "leaf", subassemblyId: null, transform: pose }, { id: "pin1", partId: "pin", subassemblyId: null, transform: pose }] };
    const duplicated = { parts: ["leaf", "pin"].map((partId) => ({ partId, stl, sha256: createHash("sha256").update(stl).digest("hex"), triangleCount: 1, diagnostics: "" })), purchasedPartIds: [] };
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: twoParts, render: async () => duplicated });
    expect(result.identity.status).toBe("FAIL");
    expect(result.identity.distinctness.groups).toEqual([["leaf", "pin"]]);
    expect(result.manifest.evidence.identity.status).toBe("FAIL");
    expect(result.manifest.evidence.identity.reason).toContain("not independently selectable");
  });
});

describe("assembly fit evidence", () => {
  const jointSpec = () => ({
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "bore", name: "Bore", selector: "bore", source: "generated", material: null },
      { id: "shaft", name: "Shaft", selector: "shaft", source: "generated", material: null },
    ],
    instances: [
      { id: "bore-instance", partId: "bore", subassemblyId: null, transform: pose },
      { id: "shaft-instance", partId: "shaft", subassemblyId: null, transform: pose },
    ],
    subassemblies: [], groundedInstanceId: "bore-instance",
    connections: [{
      id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance",
      frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
      range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  });
  const jointRender = async () => {
    const meshes = {
      bore: tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
      shaft: prismStl({ radius: 3, height: 12, segments: 64, z0: -1 }),
    };
    return {
      parts: Object.entries(meshes).map(([partId, mesh]) => ({ partId, stl: mesh, sha256: createHash("sha256").update(mesh).digest("hex"), triangleCount: mesh.readUInt32LE(80), diagnostics: "" })),
      purchasedPartIds: [],
    };
  };

  test("without a frozen requirement the assembly layer stays NOT_RUN", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: jointSpec(), render: jointRender });
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.fits).toEqual([]);
  });

  test("a satisfied requirement becomes measured assembly evidence", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
    });
    expect(result.manifest.evidence.assembly.status).toBe("PASS");
    expect(result.manifest.evidence.assembly.reason).toContain("diametral clearance");
    expect(result.fits[0].diametralClearanceMm!.min).toBeCloseTo(0.3923, 3);
    expect(result.manifest.fits[0].status).toBe("PASS");
    // Measurement does not upgrade the layers that were not measured.
    expect(result.manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");
  });

  test("a declared bore made from solid mesh cannot pass even when numerical clearance fits", async () => {
    const falseBore = prismStl({ radius: 3.2, height: 10, segments: 64 });
    const pin = prismStl({ radius: 3, height: 12, segments: 64, z0: -1 });
    const renderSolid = async () => ({
      parts: [{ partId: "bore", stl: falseBore, sha256: createHash("sha256").update(falseBore).digest("hex"), triangleCount: falseBore.readUInt32LE(80), diagnostics: "" },
        { partId: "shaft", stl: pin, sha256: createHash("sha256").update(pin).digest("hex"), triangleCount: pin.readUInt32LE(80), diagnostics: "" }],
      purchasedPartIds: [],
    });
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: renderSolid,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
    });
    expect(result.fits[0].measuredStatus).toBe("PASS");
    expect(result.fits[0].boreRoleCheck?.observedRole).toBe("shaft");
    expect(result.fits[0].status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.fits[0].reason).toContain("contradicts");
  });

  test("an unmet requirement fails and keeps the measured numbers", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.1, max: 0.3 } }],
    });
    expect(result.manifest.evidence.assembly.status).toBe("FAIL");
    expect(result.manifest.evidence.assembly.reason).toContain("outside the frozen");
    expect(result.fits[0].diametralClearanceMm!.max).toBeGreaterThan(0.4);
  });

  test("an unknown connection is an error, not a silent pass", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "missing", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0, max: 1 } }],
    });
    expect(result.manifest.evidence.assembly.status).toBe("ERROR");
  });

  test("an unconfirmed contract downgrades a passing measurement without hiding it", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
      contractGate: { evidenceCurrent: false, reason: "The contract has not been confirmed." },
    });
    expect(result.manifest.contract.evidenceCurrent).toBe(false);
    expect(result.manifest.contract.reason).toContain("has not been confirmed");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.reason).toContain("The contract has not been confirmed.");
    // The measurement is preserved: only its standing as a verdict changed.
    expect(result.manifest.fits[0].measuredStatus).toBe("PASS");
    expect(result.manifest.fits[0].diametralClearanceMm!.min).toBeCloseTo(0.3923, 3);
    expect(result.manifest.evidence.identity.status).toBe("NOT_RUN");
  });

  test("an unconfirmed contract never softens a measured failure", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.1, max: 0.3 } }],
      contractGate: { evidenceCurrent: false, reason: "The contract has not been confirmed." },
    });
    expect(result.manifest.evidence.assembly.status).toBe("FAIL");
    expect(result.manifest.fits[0].measuredStatus).toBe("FAIL");
  });

  test("a confirmed contract leaves the measured verdict alone and says so", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
      contractGate: { evidenceCurrent: true },
    });
    expect(result.manifest.contract.evidenceCurrent).toBe(true);
    expect(result.manifest.contract.reason).toContain("confirmed requirement contract");
    expect(result.manifest.evidence.assembly.status).toBe("PASS");
  });

  test("omitting the gate records that approval was never evaluated", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: jointSpec(), render: jointRender,
      fitRequirements: [{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }],
    });
    // Not `false`: the question was not asked, which is not the same as "no".
    expect(result.manifest.contract.evidenceCurrent).toBeNull();
    expect(result.manifest.contract.reason).toContain("not evaluated");
  });
});

describe("kinematics evidence", () => {
  // The fit fixture uses solid prisms, which would be reported as contained
  // rather than as a bore. Kinematics needs a real bore, so it gets a tube.
  const tubeSpec = () => ({
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "hub", name: "Hub", selector: "hub", source: "generated", material: null },
      { id: "shaft", name: "Shaft", selector: "shaft", source: "generated", material: null },
    ],
    instances: [
      { id: "hub-instance", partId: "hub", subassemblyId: null, transform: pose },
      { id: "shaft-instance", partId: "shaft", subassemblyId: null, transform: pose },
    ],
    subassemblies: [], groundedInstanceId: "shaft-instance",
    connections: [{
      id: "joint", type: "revolute", a: "shaft-instance", b: "hub-instance",
      frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
      range: { min: -30, max: 30, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  });
  const tubeRender = async () => {
    const meshes = {
      hub: tubeStl({ outerRadius: 4, innerRadius: 2.6, height: 6, segments: 48 }),
      shaft: prismStl({ radius: 2.5, height: 12, segments: 48, z0: -1 }),
    };
    return {
      parts: Object.entries(meshes).map(([partId, mesh]) => ({ partId, stl: mesh, sha256: createHash("sha256").update(mesh).digest("hex"), triangleCount: mesh.readUInt32LE(80), diagnostics: "" })),
      purchasedPartIds: [],
    };
  };

  test("a clear path and a clear range fill the assembly and motion layers", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: tubeSpec(), render: tubeRender,
      kinematics: { connectionId: "joint", pathSteps: 10, motionSteps: 10 },
    });
    expect(result.manifest.evidence.assembly.status).toBe("PASS");
    expect(result.manifest.evidence.motion.status).toBe("PASS");
    expect(result.manifest.kinematics!.path.status).toBe("PASS");
    expect(result.manifest.kinematics!.motion.status).toBe("PASS");
    expect(result.manifest.kinematics!.path.posesEvaluated).toBeGreaterThan(0);
  });

  test("without kinematics the motion layer stays unmeasured", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: tubeSpec(), render: tubeRender });
    expect(result.manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.motion.reason).toContain("not checked");
    expect(result.manifest.kinematics).toBeNull();
  });

  test("an unconfirmed contract downgrades motion too, keeping the measurement", async () => {
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: tubeSpec(), render: tubeRender,
      kinematics: { connectionId: "joint", pathSteps: 8, motionSteps: 8 },
      contractGate: { evidenceCurrent: false, reason: "The contract has not been confirmed." },
    });
    expect(result.manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(result.manifest.kinematics!.motion.status).toBe("PASS");
    expect(result.manifest.kinematics!.motion.reason).toContain("free of interference");
  });

  test("a shaft embedded in a solid body fails the path instead of passing it", async () => {
    // No bore at all, and the shaft is short enough to sit entirely inside the
    // hub, so no surface crosses. Only the containment probe can catch this.
    const solidRender = async () => {
      const meshes = {
        hub: prismStl({ radius: 4, height: 6, segments: 48 }),
        shaft: prismStl({ radius: 2.5, height: 4, segments: 48, z0: 1 }),
      };
      return {
        parts: Object.entries(meshes).map(([partId, mesh]) => ({ partId, stl: mesh, sha256: createHash("sha256").update(mesh).digest("hex"), triangleCount: mesh.readUInt32LE(80), diagnostics: "" })),
        purchasedPartIds: [],
      };
    };
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: tubeSpec(), render: solidRender,
      kinematics: { connectionId: "joint", pathSteps: 6, motionSteps: 6 },
    });
    expect(result.manifest.kinematics!.path.status).toBe("FAIL");
    expect(result.manifest.kinematics!.path.reason).toContain("CONTAINED");
    expect(result.manifest.evidence.assembly.status).toBe("FAIL");
  });
});

/**
 * A lid that rises off a plate. One part carries a bracket over the lid in the
 * blocked variant, so the same declaration passes or fails on geometry alone.
 */
describe("declared disassembly evidence", () => {
  const plate = boxStl([0, 0, 0], [10, 10, 2]);
  const bracket = boxStl([0, 0, 7], [4, 4, 9]);
  const lidMesh = boxStl([0, 0, 0], [4, 4, 4]);
  const lift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2.5, 0, 0, 0, 1];
  const lidSpec = () => ({
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "plate", name: "Plate", selector: "plate", source: "generated", material: null },
      { id: "lid", name: "Lid", selector: "lid", source: "generated", material: null },
    ],
    instances: [
      { id: "plate1", partId: "plate", subassemblyId: null, transform: pose },
      { id: "lid1", partId: "lid", subassemblyId: null, transform: lift },
    ],
    subassemblies: [], connections: [], groundedInstanceId: "plate1", motions: [],
    operations: [{
      id: "remove_lid", action: "disassemble", instanceId: "lid1", tools: [],
      waypoints: [lift, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 22.5, 0, 0, 0, 1]],
    }],
    manufacturing: null, assumptions: [], unknowns: [],
  });
  const renderWith = (base: Buffer) => async () => ({
    parts: [
      { partId: "plate", stl: base, sha256: createHash("sha256").update(base).digest("hex"), triangleCount: base.readUInt32LE(80), diagnostics: "" },
      { partId: "lid", stl: lidMesh, sha256: createHash("sha256").update(lidMesh).digest("hex"), triangleCount: lidMesh.readUInt32LE(80), diagnostics: "" },
    ],
    purchasedPartIds: [] as string[],
  });

  test("a confirmed contract reports the measured removal path as a pass", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: lidSpec(), render: renderWith(plate), contractGate: { evidenceCurrent: true } });
    expect(result.manifest.evidence.disassembly.status).toBe("PASS");
    expect(result.manifest.declaredDisassembly.status).toBe("PASS");
    expect(result.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(result.manifest.declaredDisassembly.results).toHaveLength(1);
  });

  test("an unconfirmed contract cannot present the same measurement as a verdict", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: lidSpec(), render: renderWith(plate), contractGate: { evidenceCurrent: false, reason: "Not confirmed." } });
    expect(result.manifest.evidence.disassembly.status).toBe("NOT_RUN");
    expect(result.manifest.declaredDisassembly.status).toBe("NOT_RUN");
    expect(result.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(result.manifest.declaredDisassembly.reason).toContain("measurement itself passed");
    expect(result.manifest.declaredDisassembly.measuredReason).toContain("Every declared removal passed");
  });

  test("a blocked removal fails even when the contract is unconfirmed", async () => {
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: lidSpec(), render: renderWith(mergeStl(plate, bracket)), contractGate: { evidenceCurrent: false, reason: "Not confirmed." } });
    expect(result.manifest.evidence.disassembly.status).toBe("FAIL");
    expect(result.manifest.declaredDisassembly.measuredStatus).toBe("FAIL");
    expect(result.manifest.declaredDisassembly.results[0].reason).toContain("intersects");
  });
});
