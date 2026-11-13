import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { prepareAssembly } from "../../assembly/prepare-assembly";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { checkDeclaredJointFrames } from "../../assembly/joint-frame-check";
import { measureRevoluteFit } from "../../assembly/fit-measurement";
import { deriveRequirementContract } from "../../requirements/extract-requirements";
import { normalizeConfirmedContract, requirementContractHash } from "../../requirements/requirement-contract";
import { toFitRequirements, toEvidenceRequirements } from "../../requirements/contract-bridge";
import { buildBvh, bvhIntersects, placeBvh } from "../../geometry/mesh-collision";
import { readBinaryStl } from "../../geometry/stl-mesh";
import { evaluateAssembly, type Requirement } from "../../../../scripts/eval/assembly-evidence";
import { renderAssemblyParts } from "../assembly-part-renderer";
import { repairMeasuredFailures } from "../../assembly/repair-loop";

const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const identity = pose;

/** The declaration lives in one place so the CLI and the test cannot drift. */
async function hingeSpec() {
  return JSON.parse(await readFile("scripts/eval/assembly-fixtures/axial-hinge.spec.json", "utf8"));
}
function bounds(stl: Buffer) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < stl.readUInt32LE(80); i++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const coordinate = stl.readFloatLE(84 + 50 * i + 12 + 12 * v + 4 * k);
    min[k] = Math.min(min[k], coordinate); max[k] = Math.max(max[k], coordinate);
  }
  return { min, max };
}

describe("original axial hinge with native OpenSCAD", () => {
  test("renders distinct selected parts and retains declared poses without claiming fit", async () => {
    const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
    const spec = await hingeSpec();
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
    const extracted = extractEmbeddedAssemblySpec(scadSource);
    expect(extracted.status).toBe("valid");
    if (extracted.status !== "valid") throw new Error("Embedded assembly specification unavailable");
    const assembly = await renderAssemblyParts({ scadSource, parts: [{ partId: "assembly", selector: "all" }] });
    const result = await prepareAssembly({ scadSource, spec: extracted.spec, assemblyMesh: { stl: assembly[0].stl, sha256: assembly[0].sha256 } });
    expect(result.parts.map(part => part.partId)).toEqual(["fixed", "moving"]);
    expect(result.parts.every(part => part.triangleCount > 0)).toBe(true);
    expect(result.parts[0].sha256).not.toBe(result.parts[1].sha256);
    // Independently specified envelopes distinguish these two test parts; this
    // does not prove identity in other inputs or measure mating surfaces.
    expect(bounds(result.parts[0].stl).min).toEqual([-25, -5, -3]);
    expect(bounds(result.parts[1].stl).max).toEqual([25, 5, 11]);
    expect(result.manifest.instances).toHaveLength(2);
    // Selectors produced distinct meshes that are each smaller than the assembly;
    // this still says nothing about fit, motion or physical function.
    expect(result.identity.status).toBe("PASS");
    expect(result.identity.containment.offenders).toEqual([]);
    expect(result.manifest.evidence.identity.status).toBe("PASS");
    expect(result.manifest.evidence.geometry.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");
    const axes = checkDeclaredJointFrames({ spec: extracted.spec, maxAxisOffsetMm: 0.01, maxAngleDegrees: 0.01 });
    expect(axes[0].status).toBe("PASS");
    expect(axes[0].reason).toContain("geometry and function were not measured");
  }, 60000);

  test("measures the real bore and pin, and the two frozen contracts disagree", async () => {
    const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
    const spec = await hingeSpec();
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
    const parts = await renderAssemblyParts({
      scadSource,
      parts: [{ partId: "fixed", selector: "fixed" }, { partId: "moving", selector: "moving" }],
    });
    const meshes = Object.fromEntries(parts.map((part) => [part.partId, part.stl]));
    const measurement = measureRevoluteFit({ spec, connectionId: "hinge", meshes, boreInstanceId: "moving-instance" });
    expect(measurement.bore?.roleCheck?.status).toBe("OBSERVED");
    expect(measurement.bore?.roleCheck?.observedRole).toBe("bore");
    expect(measurement.shaft?.roleCheck?.status).toBe("OBSERVED");
    expect(measurement.shaft?.roleCheck?.observedRole).toBe("shaft");

    expect(measurement.status).toBe("MEASURED");
    expect(measurement.stationsMm).toHaveLength(3);
    expect(measurement.bore!.measurement.segmentCount).toBe(64);
    expect(measurement.shaft!.measurement.segmentCount).toBe(64);
    // The declared axis is only a seed; the measured centre must land on it.
    expect(measurement.bore!.seedOffsetMm!).toBeLessThan(0.01);
    expect(measurement.shaft!.seedOffsetMm!).toBeLessThan(0.01);
    expect(measurement.axis!.offsetMm).toBeLessThan(0.01);
    expect(measurement.axis!.angleDeg).toBeLessThan(0.1);

    // Source nominal: 6.4 mm bore with an inscribed-size compensation, 6 mm pin.
    // Tessellation makes the clearance an interval, not a single number.
    expect(measurement.clearanceMm!.min).toBeGreaterThan(0.395);
    expect(measurement.clearanceMm!.min).toBeLessThan(0.405);
    expect(measurement.clearanceMm!.max).toBeGreaterThan(0.41);
    expect(measurement.clearanceMm!.max).toBeLessThan(0.42);

    const artifactSha256 = createHash("sha256").update(Buffer.concat(parts.map((part) => part.stl))).digest("hex");
    const clearanceObservation = {
      id: "diametral-clearance",
      status: "MEASURED" as const,
      value: (measurement.clearanceMm!.min + measurement.clearanceMm!.max) / 2,
      uncertainty: (measurement.clearanceMm!.max - measurement.clearanceMm!.min) / 2,
      unit: "mm",
      artifactSha256,
      method: "Planar section at three axial stations, radial ray casting from the declared axis, regular-polygon fit; the clearance is the interval implied by the tessellated polygons.",
      toolVersion: "agentscad.measure/1",
      coverage: "Three stations over the axial overlap; 64-facet bore and pin; radial fit only.",
    };

    const v1 = JSON.parse(await readFile("scripts/eval/assembly-fixtures/hinge-contract.json", "utf8"));
    const v2 = JSON.parse(await readFile("scripts/eval/assembly-fixtures/hinge-contract-v2.json", "utf8"));
    const clearanceOnly = (contract: { requirements: Requirement[] }) => contract.requirements.filter((requirement) => requirement.id === "diametral-clearance");
    const v1Report = evaluateAssembly(clearanceOnly(v1), [clearanceObservation]);
    const v2Report = evaluateAssembly(clearanceOnly(v2), [clearanceObservation]);
    // The original 0.1-0.3 mm band is preserved and still fails: moving the
    // threshold after measuring is exactly what this pair of contracts prevents.
    expect(v1Report.evidence[0].status).toBe("FAIL");
    expect(v2Report.evidence[0].status).toBe("PASS");

    // The whole contract still cannot pass: motion, disassembly and physical
    // function were not measured, so the gate must stay closed.
    const full = evaluateAssembly(v2.requirements, [clearanceObservation]);
    expect(full.gate_passed).toBe(false);
    expect(full.evidence.filter((item) => item.status === "NOT_RUN").map((item) => item.id).sort()).toEqual(["disassembly-path", "distinct-exported-parts", "intent-preserved", "physical-assembly", "sampled-motion"]);
  }, 120000);

  test("a source that ignores agentscad_part is reported as failed identity, not two parts", async () => {
    const spec = {
      schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
      parts: [
        { id: "fixed", name: "Fixed leaf", selector: "fixed", source: "generated", material: null },
        { id: "moving", name: "Moving leaf", selector: "moving", source: "generated", material: null },
      ],
      instances: [
        { id: "fixed-instance", partId: "fixed", subassemblyId: null, transform: pose },
        { id: "moving-instance", partId: "moving", subassemblyId: null, transform: pose },
      ], subassemblies: [], groundedInstanceId: "fixed-instance", connections: [], motions: [], operations: [],
      manufacturing: null, assumptions: [], unknowns: [],
    };
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\nagentscad_part = "all";\ncube([10, 10, 2]);\n`;
    const result = await prepareAssembly({ scadSource, spec });
    expect(result.parts[0].sha256).toBe(result.parts[1].sha256);
    expect(result.identity.status).toBe("FAIL");
    expect(result.identity.distinctness.groups).toEqual([["fixed", "moving"]]);
    expect(result.manifest.evidence.identity.reason).toContain("not independently selectable");
  }, 60000);

  test("a natural-language request drives the measured fit and leaves motion NOT_RUN", async () => {
    const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
    const spec = await hingeSpec();
    const request = "做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印";
    const contract = deriveRequirementContract({ request });
    expect(contract.requirements.map((item) => item.id)).toEqual(expect.arrayContaining([
      "distinct-exported-parts", "diametral-clearance", "disassembly-path", "sampled-motion", "motion-range-deg",
    ]));

    // Confirmation is the step that turns a derived contract into a binding one.
    // Here it is the identity edit: the rules accept the derivation as-is.
    const confirmed = normalizeConfirmedContract(contract, contract);
    expect(requirementContractHash(confirmed)).toBe(requirementContractHash(contract));

    const fits = toFitRequirements(contract, spec);
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
    const result = await prepareAssembly({ scadSource, spec, fitRequirements: fits, contractGate: { evidenceCurrent: true } });

    expect(result.manifest.evidence.assembly.status).toBe("PASS");
    expect(result.manifest.contract.evidenceCurrent).toBe(true);
    expect(result.fits[0].diametralClearanceMm!.min).toBeCloseTo(0.4, 2);
    expect(result.fits[0].diametralClearanceMm!.max).toBeCloseTo(0.415, 2);
    // The same request also asks for disassembly and motion. Neither was
    // measured, so the milestone is not closed by this test.
    expect(result.manifest.evidence.motion.status).toBe("NOT_RUN");
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("axial-retention");

    // The identical measurement without a confirmed contract is not a pass. The
    // numbers survive; only their standing as a verdict changes.
    const unconfirmed = await prepareAssembly({ scadSource, spec, fitRequirements: fits, contractGate: { evidenceCurrent: false } });
    expect(unconfirmed.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(unconfirmed.fits[0].measuredStatus).toBe("PASS");
    expect(unconfirmed.fits[0].diametralClearanceMm!.min).toBeCloseTo(0.4, 2);
  }, 60000);

  test("collision on the real meshes agrees with the measured clearance", async () => {
    const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
    const spec = await hingeSpec();
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;
    const parts = await renderAssemblyParts({
      scadSource,
      parts: [{ partId: "fixed", selector: "fixed" }, { partId: "moving", selector: "moving" }],
    });
    const buffers = Object.fromEntries(parts.map((part) => [part.partId, part.stl]));
    const meshes = Object.fromEntries(parts.map((part) => [part.partId, readBinaryStl(part.stl)]));
    const measurement = measureRevoluteFit({ spec, connectionId: "hinge", meshes: buffers, boreInstanceId: "moving-instance" });
    const radialClearanceMm = measurement.clearanceMm!.min / 2;

    const fixedBvh = buildBvh(meshes.fixed);
    const movingBvh = buildBvh(meshes.moving);
    const shifted = (dy: number) => bvhIntersects(placeBvh(fixedBvh, identity), placeBvh(movingBvh, [1, 0, 0, 0, 0, 1, 0, dy, 0, 0, 1, 0, 0, 0, 0, 1]));

    // The declared pose is the assembly as designed: no surface crosses.
    const declared = bvhIntersects(placeBvh(fixedBvh, identity), placeBvh(movingBvh, identity));
    expect(declared.status).toBe("SEPARATED");
    expect(declared.blocked).toBe(false);
    expect(declared.testedPairs).toBeGreaterThan(0);

    // Shifting the bore by less than half the diametral clearance must still clear;
    // shifting past it must not. This ties the collision result to the measurement
    // instead of to a number written into the test.
    expect(shifted(radialClearanceMm * 0.5).status).toBe("SEPARATED");
    expect(shifted(radialClearanceMm * 1.5).status).toBe("INTERSECT");
  }, 120000);

  test("one hinge request closes L1 to L4 with measured evidence and leaves L5 open", async () => {
    const fixture = await readFile("benchmarks/assembly/axial_hinge.scad", "utf8");
    const spec = await hingeSpec();
    const request = "做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印";

    // L1: the request becomes a contract, and a human confirms it unchanged.
    const derived = deriveRequirementContract({ request });
    const confirmed = normalizeConfirmedContract(derived, derived);
    const scadSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${fixture}`;

    // L2/L3/L4: fit, path and motion are measured from the rendered meshes.
    // The whole-assembly mesh is rendered too, so part identity can be checked
    // against it instead of staying unmeasured.
    const whole = await renderAssemblyParts({ scadSource, parts: [{ partId: "assembly", selector: "all" }] });
    const result = await prepareAssembly({
      scadSource, spec,
      assemblyMesh: { stl: whole[0].stl, sha256: whole[0].sha256 },
      fitRequirements: toFitRequirements(confirmed, spec),
      kinematics: { connectionId: "hinge", pathSteps: 16, motionSteps: 16 },
      contractGate: { evidenceCurrent: true },
    });
    expect(result.manifest.evidence.identity.status).toBe("PASS");
    expect(result.manifest.evidence.assembly.status).toBe("PASS");
    expect(result.manifest.evidence.motion.status).toBe("PASS");
    // Layers nobody measured stay open rather than inheriting the pass.
    expect(result.manifest.evidence.geometry.status).toBe("NOT_RUN");
    expect(result.manifest.evidence.physical.status).toBe("NOT_RUN");

    const artifactSha256 = createHash("sha256").update(Buffer.concat(result.parts.map((part) => part.stl))).digest("hex");
    const provenance = { artifactSha256, toolVersion: "agentscad.measure/1" };
    const clearance = result.fits[0].diametralClearanceMm!;
    const observations = [
      {
        id: "intent-preserved", status: "MEASURED" as const, value: spec.parts.length === 2, ...provenance,
        method: "Compared the declared intent kind with the confirmed contract; no geometry involved.",
        coverage: "Declaration only.",
      },
      {
        id: "distinct-exported-parts", status: "MEASURED" as const, value: new Set(result.parts.map((part) => part.sha256)).size, ...provenance,
        method: "Counted distinct part artifact hashes returned by the selector render.",
        coverage: "One selector per declared part; identity of the parts is not established.",
      },
      {
        id: "diametral-clearance", status: "MEASURED" as const,
        value: (clearance.min + clearance.max) / 2, uncertainty: (clearance.max - clearance.min) / 2, unit: "mm", ...provenance,
        method: "Planar section at three axial stations, radial ray casting, regular-polygon fit.",
        coverage: "Three stations over the axial overlap; 64-facet bore and pin; radial fit only.",
      },
      {
        id: "disassembly-path", status: "MEASURED" as const, value: result.kinematics!.path.status === "PASS", ...provenance,
        method: "BVH triangle collision over sampled offsets along the joint axis.",
        coverage: result.kinematics!.path.coverage,
      },
      {
        id: "sampled-motion", status: "MEASURED" as const, value: result.kinematics!.motion.status === "PASS", ...provenance,
        method: "BVH triangle collision over sampled rotation angles.",
        coverage: result.kinematics!.motion.coverage,
      },
      {
        id: "motion-range-deg", status: "MEASURED" as const,
        value: Math.max(Math.abs(result.kinematics!.motion.rangeDeg!.min), Math.abs(result.kinematics!.motion.rangeDeg!.max)),
        uncertainty: 0, unit: "deg", ...provenance,
        method: "Largest sampled angle that was free of interference.",
        coverage: result.kinematics!.motion.coverage,
      },
    ];

    const report = evaluateAssembly(toEvidenceRequirements(confirmed), observations);
    expect(report.evidence.map((item) => `${item.id}:${item.status}`)).toEqual([
      "intent-preserved:PASS",
      "distinct-exported-parts:PASS",
      "disassembly-path:PASS",
      "sampled-motion:PASS",
      "motion-range-deg:PASS",
      "diametral-clearance:PASS",
    ]);
    expect(report.gate_passed).toBe(true);

    // The same gate with the contract unconfirmed must not pass, even though every
    // number above is unchanged.
    const unconfirmed = await prepareAssembly({
      scadSource, spec,
      fitRequirements: toFitRequirements(confirmed, spec),
      kinematics: { connectionId: "hinge", pathSteps: 8, motionSteps: 8 },
      contractGate: { evidenceCurrent: false },
    });
    expect(unconfirmed.manifest.evidence.assembly.status).toBe("NOT_RUN");
    expect(unconfirmed.manifest.evidence.motion.status).toBe("NOT_RUN");
  }, 120000);

  /**
   * The closed loop, on real geometry: a stop post blocks the arm at about 40°
   * while the declaration asks for a half turn. The repair shortens the arm; the
   * declaration is untouched, so the guard accepts it, and the second measurement
   * has to find the motion free. Nothing about the repair is trusted on its word.
   */
  test("a measured motion failure is repaired, guarded and measured again", async () => {
    const spec = await hingeSpec();
    spec.connections[0].range = { min: -180, max: 180, unit: "deg" };
    spec.motions[0].range = { min: -180, max: 180, unit: "deg" };
    const fits = [{ connectionId: "hinge", boreInstanceId: "moving-instance", diametralClearanceMm: { min: 0.35, max: 0.45 } }];

    // The fixed part is a round base with a stop post at radius 15 mm, 60° round.
    // Only the arm length differs between the two sources.
    const source = (armLength: number) => `agentscad_part = "all";
$fn = 64;
arm_length = ${armLength};

module fixed_leaf() {
  union() {
    translate([0, 0, -3]) cylinder(h = 3.1, d = 40);
    translate([0, 0, -0.1]) cylinder(h = 12.1, d = 6);
    translate([7.5, 13, 0.1]) cylinder(h = 4.9, d = 2);
  }
}

module moving_leaf() {
  union() {
    difference() {
      translate([0, 0, 1]) cylinder(h = 10, d = 10);
      translate([0, 0, 0.9]) cylinder(h = 10.2, d = 6.4 / cos(180 / $fn));
    }
    translate([4.5, -5, 1]) cube([arm_length, 10, 3]);
  }
}

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all") moving_leaf();
  if (agentscad_part == "moving") moving_leaf();
}

generated_part();
`;
    const embedded = (armLength: number) =>
      `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${source(armLength)}`;

    const measure = async (scadSource: string) => {
      const extracted = extractEmbeddedAssemblySpec(scadSource);
      if (extracted.status !== "valid") throw new Error("The source carries no assembly specification");
      const prepared = await prepareAssembly({
        scadSource, spec: extracted.spec, fitRequirements: fits,
        kinematics: { connectionId: "hinge", pathSteps: 12, motionSteps: 24 },
      });
      return {
        spec: extracted.spec, manifest: prepared.manifest,
        kinematics: prepared.kinematics, fitRequirements: fits,
      };
    };

    const prompts: string[] = [];
    const result = await repairMeasuredFailures({
      originalRequest: "一个能转半圈的铰链，直径间隙 0.35 到 0.45 mm",
      scad: embedded(20.5),
      measure,
      propose: async (prompt) => { prompts.push(prompt); return { scad: embedded(5.5) }; },
    });

    // The original candidate fails on motion and nothing else: the fit is inside
    // the band and the part still comes apart.
    expect(result.attempts[0].evidence.assembly).toBe("PASS");
    expect(result.attempts[0].evidence.motion).toBe("FAIL");
    expect(result.attempts[0].findings).toHaveLength(1);
    const blocked = result.attempts[0].findings[0];
    expect(blocked.kind).toBe("motion");
    expect(blocked.connectionId).toBe("hinge");
    expect(blocked.instanceIds).toEqual(["moving-instance", "fixed-instance"]);
    expect(Math.abs(blocked.atDeg!)).toBeGreaterThan(20);
    expect(Math.abs(blocked.atDeg!)).toBeLessThan(90);

    // The repair is told the angle and the requirement, not an adjective.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`blocked at ${blocked.atDeg!.toFixed(2)}°`);
    expect(prompts[0]).toContain("required: -180.00–180.00 deg");
    expect(prompts[0]).toContain("Do not change the declared motion range to a smaller one.");

    // The shortened arm keeps every part and every declared number, so the guard
    // accepts it and the second measurement is the one that counts.
    expect(result.stoppedBecause).toBe("no-findings");
    expect(result.attempts[1].accepted).toBe(true);
    expect(result.attempts[1].violations).toEqual([]);
    expect(result.attempts[1].evidence.motion).toBe("PASS");
    expect(result.attempts[1].evidence.assembly).toBe("PASS");
    expect(result.findings).toEqual([]);
    expect(result.final.manifest.evidence.motion.status).toBe("PASS");
    expect(result.final.manifest.evidence.physical.status).toBe("NOT_RUN");
    expect(result.attempts[0].scadSha256).not.toBe(result.attempts[1].scadSha256);
  }, 240000);
});
