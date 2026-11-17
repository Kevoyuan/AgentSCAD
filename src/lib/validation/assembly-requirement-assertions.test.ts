import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec } from "../assembly/assembly-spec";
import type { prepareContractAssembly } from "../assembly/prepare-contract-assembly";
import { deriveRequirementContract } from "../requirements/extract-requirements";
import { extractEmbeddedAssemblySpec } from "../assembly/embedded-spec";
import { assessAssemblyRequirements } from "./assembly-requirement-assertions";

const contract = deriveRequirementContract({ request: "两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆" });
const specFile = "scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json";
type Prepared = Awaited<ReturnType<typeof prepareContractAssembly>>;

test("requirements use the candidate's own export, fit and sampled motion evidence", async () => {
  const spec = validateAssemblySpec(JSON.parse(await readFile(specFile, "utf8")));
  expect(spec.success).toBe(true);
  if (!spec.success) return;
  const prepared = {
    parts: [{}, {}], manifest: { evidence: { identity: { status: "PASS", reason: "distinct" }, motion: { status: "PASS", reason: "sampled" }, sourceMotion: { status: "PASS", reason: "source input samples" } } },
    kinematics: { motion: { status: "PASS", rangeDeg: { min: -45, max: 45 } } },
    fits: [{ connectionId: "hinge", status: "PASS", measuredStatus: "PASS", diametralClearanceMm: { min: 0.39, max: 0.42 }, stationsMm: [-4, 0, 4] }],
  } as unknown as Prepared;
  const results = (candidate: Prepared) => Object.fromEntries(assessAssemblyRequirements(contract, spec.data, candidate).map(item => [item.id, item]));
  const good = results(prepared);
  for (const id of ["distinct-exported-parts", "motion-range-deg", "motion-range-negative-end", "motion-range-positive-end", "diametral-clearance"])
    expect(good[id].status).toBe("PASS");
  expect(good["motion-range-deg"].reason).toContain("Continuous clearance and physical stops remain unverified");
  const missingSource = results({ ...prepared, manifest: { ...prepared.manifest, evidence: { ...prepared.manifest.evidence, sourceMotion: { status: "NOT_RUN", reason: "missing binding" } } } });
  expect(missingSource["motion-range-deg"].status).toBe("NOT_RUN");

  const missingPart = results({ ...prepared, parts: prepared.parts.slice(0, 1) });
  expect(missingPart["distinct-exported-parts"].status).toBe("FAIL");
  const unresolvedIdentity = results({ ...prepared, manifest: { ...prepared.manifest, evidence: { ...prepared.manifest.evidence, identity: { status: "NOT_RUN", reason: "not confirmed" } } } });
  expect(unresolvedIdentity["distinct-exported-parts"].status).toBe("NOT_RUN");

  const narrow = results({ ...prepared, kinematics: { ...prepared.kinematics!, motion: { ...prepared.kinematics!.motion, rangeDeg: { min: -30, max: 45 } } } });
  expect(narrow["motion-range-negative-end"].status).toBe("FAIL");
  expect(narrow["motion-range-positive-end"].status).toBe("PASS");
  const collision = results({ ...prepared, manifest: { ...prepared.manifest, evidence: { ...prepared.manifest.evidence, motion: { status: "FAIL", reason: "collision" } } } });
  expect(collision["motion-range-negative-end"].status).toBe("NOT_RUN");

  expect(results({ ...prepared, fits: [] })["diametral-clearance"].status).toBe("NOT_RUN");
  const straddles = results({ ...prepared, fits: [{ ...prepared.fits[0], diametralClearanceMm: { min: 0.34, max: 0.42 } }] });
  expect(straddles["diametral-clearance"].status).toBe("ERROR");
  const tooWide = results({ ...prepared, fits: [{ ...prepared.fits[0], diametralClearanceMm: { min: 0.46, max: 0.5 } }] });
  expect(tooWide["diametral-clearance"].status).toBe("FAIL");
  const unconfirmed = results({ ...prepared, fits: [{ ...prepared.fits[0], status: "NOT_RUN", reason: "not confirmed" }] });
  expect(unconfirmed["diametral-clearance"].status).toBe("NOT_RUN");
});

const retentionFixture = await readFile(
  "scripts/eval/assembly-fixtures/candidates/thick-hinge-control-2026-11-11.scad", "utf8");
const retentionExtracted = extractEmbeddedAssemblySpec(retentionFixture);
if (retentionExtracted.status !== "valid") throw new Error("Retention fixture has no valid declaration");
const retentionSpec = retentionExtracted.spec;
const retentionRequest = "两件式铰链，直径间隙0.35到0.45mm，工作姿态必须有轴向防脱，可拆卸";
const retentionContract = deriveRequirementContract({ request: retentionRequest });
const retentionOnlyContract = deriveRequirementContract({ request: "两件式铰链，工作姿态必须有轴向防脱" });
type ProbeResult = { id: string; instanceId: string; status: string; reason: string; measuredStatus?: string };
const retentionPrepared = (mutate?: (results: ProbeResult[]) => ProbeResult[], evidenceCurrent: boolean | null = true): Prepared => {
  const results = (retentionSpec.translationProbes ?? []).map((probe) => ({
    id: probe.id, instanceId: probe.instanceId, status: "PASS", reason: "A sampled translation is blocked", measuredStatus: "PASS",
  }));
  return {
    parts: [{}, {}],
    manifest: {
      contract: { evidenceCurrent },
      evidence: { identity: { status: "PASS", reason: "distinct exported designs" } },
      translationProbes: { status: "PASS", reason: "declared probes passed", results: mutate ? mutate(results) : results },
    },
    fits: [],
    kinematics: null,
  } as unknown as Prepared;
};
const retentionAssertion = (candidate: Prepared, spec: typeof retentionSpec = retentionSpec, contract = retentionContract) =>
  assessAssemblyRequirements(contract, spec, candidate).find((item) => item.id === "axial-retention");
const probesWith = (predicate: (probe: NonNullable<typeof retentionSpec.translationProbes>[number]) => boolean) => ({
  ...retentionSpec,
  translationProbes: (retentionSpec.translationProbes ?? []).filter(predicate),
});

test("axial retention binds a blocked working pose to the declared withdrawal direction", () => {
  expect(retentionContract.requirements.find((item) => item.id === "axial-retention")?.required).toBe(true);
  const passing = retentionAssertion(retentionPrepared())!;
  expect(passing.status).toBe("PASS");
  expect(passing.reason).toContain("withdrawal direction");
  expect(passing.reason).toContain("holding force");

  const noProbes = { ...retentionSpec, translationProbes: [] };
  expect(retentionAssertion(retentionPrepared(), noProbes)!.status).toBe("NOT_RUN");
});

test("a blocked insertion probe cannot substitute for withdrawal retention", () => {
  const insertionOnly = probesWith((probe) => probe.id.endsWith("_down") || probe.expected === "clear");
  const result = retentionAssertion(retentionPrepared(), insertionOnly)!;
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("withdrawal direction");
});

test("a clear probe must start at a declared disassembly pose", () => {
  const moved: typeof retentionSpec = {
    ...retentionSpec,
    translationProbes: (retentionSpec.translationProbes ?? []).map((probe) =>
      probe.id === "released_withdrawal"
        ? { ...probe, startTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 100, 0, 0, 0, 1] }
        : probe),
  };
  const result = retentionAssertion(retentionPrepared(), moved)!;
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("disassembly pose");
});

test("a blocked probe must start at a declared working pose", () => {
  const floated: typeof retentionSpec = {
    ...retentionSpec,
    translationProbes: (retentionSpec.translationProbes ?? []).map((probe) =>
      probe.expected === "blocked"
        ? { ...probe, startTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 0, 0, 0, 1] }
        : probe),
  };
  const result = retentionAssertion(retentionPrepared(), floated)!;
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("working pose");
});

test("retention without independent release requires blocked probes in both axial directions", () => {
  expect(retentionOnlyContract.requirements.some((item) => item.id === "axial-retention" && item.required)).toBe(true);
  const passing = retentionAssertion(retentionPrepared(), retentionSpec, retentionOnlyContract)!;
  expect(passing.status).toBe("PASS");
  expect(passing.reason).toContain("both axial directions");

  const positiveOnly = probesWith((probe) => probe.expected === "clear" || probe.translationMm[2] > 0);
  const result = retentionAssertion(retentionPrepared(), positiveOnly, retentionOnlyContract)!;
  expect(result.status).toBe("NOT_RUN");
  expect(result.reason).toContain("both axial directions");
});

test("measured failures and unavailable evidence keep precedence over missing results", () => {
  const mixed = retentionPrepared((results) => results
    .filter((result) => result.id !== "hold_zero0_up")
    .map((result) => result.id === "hold_zero0_down" ? { ...result, status: "FAIL", reason: "measured penetration" } : result));
  const failed = retentionAssertion(mixed)!;
  expect(failed.status).toBe("FAIL");
  expect(failed.reason).toContain("hold_zero0_down");

  const unconfirmed = retentionAssertion(retentionPrepared(undefined, null))!;
  expect(unconfirmed.status).toBe("NOT_RUN");
  expect(unconfirmed.reason).toContain("confirmed requirement contract");
  const rejected = retentionAssertion(retentionPrepared(undefined, false))!;
  expect(rejected.status).toBe("NOT_RUN");
  expect(rejected.reason).toContain("confirmed requirement contract");

  const gated = retentionPrepared((results) => results.map((result) => ({
    ...result, status: "NOT_RUN", reason: "The requirement contract has not been confirmed.",
  })));
  const gatedResult = retentionAssertion(gated)!;
  expect(gatedResult.status).toBe("NOT_RUN");
  expect(gatedResult.reason).toContain("not been confirmed");
});

test("axial retention rejects probes that do not move one joint instance along the declared axis", () => {
  const lateral: typeof retentionSpec = {
    ...retentionSpec,
    translationProbes: (retentionSpec.translationProbes ?? []).map((probe) => ({
      ...probe, translationMm: [4, 0, 0] as [number, number, number],
    })),
  };
  expect(retentionAssertion(retentionPrepared(), lateral)!.status).toBe("NOT_RUN");

  const mixedBodies: typeof retentionSpec = {
    ...retentionSpec,
    translationProbes: (retentionSpec.translationProbes ?? []).map((probe, index) =>
      index === 0 ? { ...probe, instanceId: "a1" } : probe),
  };
  expect(retentionAssertion(retentionPrepared(), mixedBodies)!.status).toBe("NOT_RUN");

  const withoutAxis: typeof retentionSpec = {
    ...retentionSpec,
    connections: retentionSpec.connections.map((connection) => ({ ...connection, frameA: null })),
  };
  expect(retentionAssertion(retentionPrepared(), withoutAxis)!.status).toBe("NOT_RUN");

  const twoRevolutes: typeof retentionSpec = {
    ...retentionSpec,
    connections: [...retentionSpec.connections, { ...retentionSpec.connections[0], id: "hinge-2" }],
  };
  expect(retentionAssertion(retentionPrepared(), twoRevolutes)!.status).toBe("NOT_RUN");

  const notRequiredTrue = {
    ...retentionContract,
    requirements: retentionContract.requirements.map((item) =>
      item.id === "axial-retention" ? { ...item, expected: { kind: "equals" as const, value: false } } : item),
  };
  expect(retentionAssertion(retentionPrepared(), retentionSpec, notRequiredTrue)!.status).toBe("NOT_RUN");
});


test("measured slider-crank dimensions satisfy explicit crank radius and rod length", () => {
  const derived = deriveRequirementContract({ request: "做一个曲柄滑块机构，曲柄半径 8 mm，连杆长度 28 mm，能转 360 度" });
  const contract = { ...derived, requirements: derived.requirements.filter((item) => item.id === "crank-radius" || item.id === "rod-length") };
  const base = retentionPrepared();
  const withDimensions = (crankRadiusMm: number, rodLengthMm: number): Prepared => ({
    ...base,
    manifest: {
      ...base.manifest,
      mechanismDimensions: {
        status: "MEASURED", crankRadiusMm, rodLengthMm,
        crankPinRadiusMm: { min: 1.999, max: 2.001 }, rodBoreRadiusMm: { min: 2.199, max: 2.201 },
        reason: "Measured from mesh sections", coverage: "three station families", assumptions: [],
      },
    },
  } as unknown as Prepared);
  const assertions = (prepared: Prepared) => Object.fromEntries(
    assessAssemblyRequirements(contract, retentionSpec, prepared).map((item) => [item.id, item]));
  const passing = assertions(withDimensions(8.0000001, 27.9999998));
  expect(passing["crank-radius"].status).toBe("PASS");
  expect(passing["rod-length"].status).toBe("PASS");
  const outside = assertions(withDimensions(8.5, 29.5));
  expect(outside["crank-radius"].status).toBe("FAIL");
  expect(outside["rod-length"].status).toBe("FAIL");
  const missing = assertions(base);
  expect(missing["crank-radius"].status).toBe("NOT_RUN");
  const failedMeasurement: Prepared = {
    ...base,
    manifest: { ...base.manifest, mechanismDimensions: { status: "ERROR", crankRadiusMm: null, rodLengthMm: null,
      crankPinRadiusMm: null, rodBoreRadiusMm: null, reason: "pin not measurable", coverage: "", assumptions: [] } },
  } as unknown as Prepared;
  expect(assertions(failedMeasurement)["crank-radius"].status).toBe("ERROR");
});
