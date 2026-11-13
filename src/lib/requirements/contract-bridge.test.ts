import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { deriveRequirementContract } from "./extract-requirements";
import { toEvidenceRequirements, toFitRequirements, resolveContractFitRequirements } from "./contract-bridge";
import { prepareAssembly } from "../assembly/prepare-assembly";
import { prismStl } from "../geometry/__tests__/prism";
import { tubeStl } from "../geometry/__tests__/solids";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const axis = { origin: [0, 0, 0], direction: [0, 0, 1] };

function spec(connections?: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "bore", name: "Bore", selector: "bore", source: "generated", material: null },
      { id: "shaft", name: "Shaft", selector: "shaft", source: "generated", material: null },
    ],
    instances: [
      { id: "bore-instance", partId: "bore", subassemblyId: null, transform: identity },
      { id: "shaft-instance", partId: "shaft", subassemblyId: null, transform: identity },
    ],
    subassemblies: [], groundedInstanceId: "bore-instance",
    connections: connections ?? [{
      id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance",
      frameA: axis, frameB: axis, range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
    }],
    motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
}

describe("contract to fit requirement", () => {
  test("a stated clearance range becomes a measurable fit requirement", () => {
    const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙 0.1 到 0.3 mm，可拆" });
    const fits = toFitRequirements(contract, spec(), { boreInstanceId: "bore-instance" });
    expect(fits).toEqual([{ connectionId: "joint", boreInstanceId: "bore-instance", diametralClearanceMm: { min: 0.1, max: 0.3 } }]);
  });

  test("a contract without a clearance range produces no fit requirement", () => {
    const contract = deriveRequirementContract({ request: "两件式铰链，可拆" });
    expect(toFitRequirements(contract, spec(), { boreInstanceId: "bore-instance" })).toEqual([]);
  });

  test("two revolute connections must be disambiguated", () => {
    const contract = deriveRequirementContract({ request: "铰链，直径间隙 0.1 到 0.3 mm" });
    const second = {
      id: "joint2", type: "revolute", a: "shaft-instance", b: "bore-instance",
      frameA: axis, frameB: axis, range: null, pitchMm: null, ratio: null, allowedContact: [],
    };
    expect(() => toFitRequirements(contract, spec([
      { id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance", frameA: axis, frameB: axis, range: null, pitchMm: null, ratio: null, allowedContact: [] },
      second,
    ]), { boreInstanceId: "bore-instance" })).toThrow("exactly one revolute");
    expect(toFitRequirements(contract, spec([
      { id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance", frameA: axis, frameB: axis, range: null, pitchMm: null, ratio: null, allowedContact: [] },
      second,
    ]), { boreInstanceId: "bore-instance", connectionId: "joint2" })[0].connectionId).toBe("joint2");
  });

  test("a bore instance outside the connection is refused", () => {
    const contract = deriveRequirementContract({ request: "铰链，直径间隙 0.1 到 0.3 mm" });
    expect(() => toFitRequirements(contract, spec(), { boreInstanceId: "other-instance" })).toThrow("one of the connection");
  });

  test("the evidence bridge keeps only in-scope assertions", () => {
    const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙 0.1 到 0.3 mm，可拆" });
    const requirements = toEvidenceRequirements(contract);
    expect(requirements.map((item) => item.id)).toContain("diametral-clearance");
    expect(requirements.every((item) => item.layer !== "physical")).toBe(true);
  });

  test("a declaration that names the bore needs no caller-supplied role", () => {
    const contract = deriveRequirementContract({ request: "铰链，直径间隙 0.1 到 0.3 mm" });
    const declared = spec([{
      id: "joint", type: "revolute", a: "bore-instance", b: "shaft-instance",
      frameA: axis, frameB: axis, range: null, pitchMm: null, ratio: null,
      boreInstanceId: "bore-instance", allowedContact: [],
    }]);
    expect(toFitRequirements(contract, declared)[0].boreInstanceId).toBe("bore-instance");
    expect(() => toFitRequirements(contract, spec())).toThrow("does not name which instance carries the bore");
  });
});

describe("request to measured evidence", () => {
  const render = async () => {
    const meshes = {
      bore: tubeStl({ outerRadius: 5, innerRadius: 3.2, height: 10, segments: 64 }),
      shaft: prismStl({ radius: 3, height: 12, segments: 64, z0: -1 }),
    };
    return {
      parts: Object.entries(meshes).map(([partId, stl]) => ({ partId, stl, sha256: createHash("sha256").update(stl).digest("hex"), triangleCount: stl.readUInt32LE(80), diagnostics: "" })),
      purchasedPartIds: [],
    };
  };

  test("a natural-language clearance range drives a measured assembly verdict", async () => {
    const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙 0.35 到 0.45 mm，可拆" });
    const fits = toFitRequirements(contract, spec(), { boreInstanceId: "bore-instance" });
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: spec(), render, fitRequirements: fits });
    expect(result.manifest.evidence.assembly.status).toBe("PASS");
    expect(result.fits[0].diametralClearanceMm!.min).toBeCloseTo(0.3923, 3);
  });

  test("a request the geometry cannot meet fails instead of being adjusted", async () => {
    const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙 0.1 到 0.3 mm，可拆" });
    const fits = toFitRequirements(contract, spec(), { boreInstanceId: "bore-instance" });
    const result = await prepareAssembly({ scadSource: "cube(1);", spec: spec(), render, fitRequirements: fits });
    expect(result.manifest.evidence.assembly.status).toBe("FAIL");
    expect(result.manifest.evidence.assembly.reason).toContain("outside the frozen");
    // The contract is unchanged: the failure is recorded, not absorbed.
    expect(contract.requirements.find((item) => item.id === "diametral-clearance")?.expected).toEqual({ kind: "range", min: 0.1, max: 0.3, unit: "mm" });
  });

  test("automatically binds explicitly requested clearance to real meshes but refuses an uncalibrated feature-identity PASS", async () => {
    const request = "两件式铰链，直径间隙 0.35 到 0.45 mm，可拆";
    const contract = deriveRequirementContract({ request });
    const declared = spec([{ ...spec().connections[0], boreInstanceId: "bore-instance" }]);
    const resolved = resolveContractFitRequirements(contract, declared);
    expect(resolved.status).toBe("READY");
    expect(resolved.required).toBe(true);
    expect(resolved.featureIdentityStatus).toBe("NOT_RUN");
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: declared, render,
      contractSnapshot: { contract, request },
      contractGate: { evidenceCurrent: true },
    });
    expect(result.manifest.fitBinding?.status).toBe("READY");
    expect(result.manifest.fitBinding?.featureIdentityStatus).toBe("NOT_RUN");
    expect(result.fits).toHaveLength(1);
    expect(result.fits[0].measuredStatus).toBe("PASS");
    expect(result.fits[0].status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.fits[0].diametralClearanceMm?.min).toBeCloseTo(0.3923, 3);
    expect(result.fits[0].reason).toContain("not independently verified");
    expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");
  });

  test("a candidate clearance outside the frozen contract is visible as raw FAIL, never a false validated PASS", async () => {
    const request = "两件式铰链，直径间隙 0.1 到 0.3 mm，可拆";
    const contract = deriveRequirementContract({ request });
    const declared = spec([{ ...spec().connections[0], boreInstanceId: "bore-instance" }]);
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: declared, render,
      contractSnapshot: { contract, request },
      contractGate: { evidenceCurrent: true },
    });
    expect(result.fits[0].measuredStatus).toBe("FAIL");
    expect(result.fits[0].status).toBe("NOT_RUN");
    expect(result.fits[0].reason).toContain("outside the frozen");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
  });

  test("unconfirmed requirements cannot promote an automatic mesh-fit check", async () => {
    const request = "两件式铰链，直径间隙 0.35 到 0.45 mm，可拆";
    const contract = deriveRequirementContract({ request });
    const declared = spec([{ ...spec().connections[0], boreInstanceId: "bore-instance" }]);
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: declared, render,
      contractSnapshot: { contract, request },
      contractGate: { evidenceCurrent: false, reason: "No confirmed contract" },
    });
    expect(result.fits[0].measuredStatus).toBe("PASS");
    expect(result.fits[0].status).toBe("NOT_RUN");
    expect(result.manifest.contract.evidenceCurrent).toBe(false);
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
  });

  test("missing bore identity and multiple revolute joints fail closed instead of guessing or throwing", async () => {
    const request = "两件式铰链，直径间隙 0.35 到 0.45 mm，可拆";
    const contract = deriveRequirementContract({ request });
    const missing = resolveContractFitRequirements(contract, spec());
    expect(missing.status).toBe("NOT_RUN");
    expect(missing.required).toBe(true);
    expect(missing.requirements).toEqual([]);
    expect(missing.reason).toContain("bore");
    const result = await prepareAssembly({
      scadSource: "cube(1);", spec: spec(), render,
      contractSnapshot: { contract, request },
      contractGate: { evidenceCurrent: true },
    });
    expect(result.fits).toEqual([]);
    expect(result.manifest.fitBinding?.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.reason).toContain("contract fit");

    const first = { ...spec().connections[0], boreInstanceId: "bore-instance" };
    const multi = spec([first, { ...first, id: "joint-other" }]);
    expect(resolveContractFitRequirements(contract, multi).status).toBe("NOT_RUN");
    expect(resolveContractFitRequirements(contract, multi).reason).toContain("exactly one revolute");
  });

  test("waived or absent clearance requirements do not trigger guessed fit measurement", () => {
    const request = "两件式铰链，直径间隙 0.35 到 0.45 mm，可拆";
    const contract = deriveRequirementContract({ request });
    const waived = structuredClone(contract);
    const clearance = waived.requirements.find(item => item.id === "diametral-clearance")!;
    clearance.required = false;
    clearance.applicable = false;
    expect(resolveContractFitRequirements(waived, spec()).required).toBe(false);
    expect(resolveContractFitRequirements(waived, spec()).requirements).toEqual([]);
    expect(resolveContractFitRequirements(deriveRequirementContract({ request: "两件式铰链" }), spec()).required).toBe(false);
  });

});
