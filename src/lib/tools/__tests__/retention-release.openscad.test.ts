import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderAssemblyParts } from "../assembly-part-renderer";
import { checkTranslationProbe } from "../../assembly/translation-probe";
import { checkRigidPosePath } from "../../assembly/rigid-pose-path";
import { rotationAboutAxis } from "../../assembly/path-and-motion";
import { checkPartConnectivity } from "../../assembly/part-connectivity";
import { checkPartIdentity } from "../../assembly/part-identity-check";
import { prepareAssembly } from "../../assembly/prepare-assembly";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { buildBvh, placeBvh, bvhIntersects } from "../../geometry/mesh-collision";
import { readBinaryStl, meshBounds } from "../../geometry/stl-mesh";
import {validateAssemblyArtifact} from "../../validation/assembly-validation";
import {judgeAssemblyCandidate} from "../../../../scripts/eval/judge-assembly";
import {measureRevoluteFit} from "../../assembly/fit-measurement";

test("retained generated hinge cannot hide invalid schema, non-manifold contact or default overlap",async()=>{
  const scadSource=await readFile("scripts/eval/assembly-fixtures/failures/controlled-release-hinge-2026-11-07.scad","utf8");
  expect(extractEmbeddedAssemblySpec(scadSource).status).toBe("invalid");
  const rendered=await renderAssemblyParts({scadSource,parts:["hinge_base","hinge_flap","all"].map(id=>({partId:id,selector:id}))});
  const base=rendered.find(p=>p.partId==="hinge_base")!,flap=rendered.find(p=>p.partId==="hinge_flap")!;
  expect(checkPartIdentity({parts:[base,flap].map(p=>({...p,selector:p.partId})),assemblyMesh:rendered.find(p=>p.partId==="all")!}).status).toBe("PASS");
  expect(checkPartConnectivity(flap.stl).status).toBe("NOT_RUN");
  const collision=bvhIntersects(placeBvh(buildBvh(readBinaryStl(base.stl))),placeBvh(buildBvh(readBinaryStl(flap.stl))));
  expect(collision.status).toBe("INTERSECT");
  expect(collision.blocked).toBe(true);
},60000);

test("invalid retained declaration still supplies native geometry diagnostics to production and trial repair",async()=>{
  const scadSource=await readFile("scripts/eval/assembly-fixtures/failures/controlled-release-hinge-2026-11-07.scad","utf8");
  const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，可拆卸",scadSource});
  expect(row.status).toBe("FAIL");expect(row.passed).toBe(false);
  expect(row.assemblyDiagnostics?.execution).toBe("COMPLETED");
  expect(row.assemblyDiagnostics?.parts.find(p=>p.partId==="hinge_flap")?.measurement.status).toBe("NOT_RUN");
  expect(row.assemblyDiagnostics?.parts.find(p=>p.partId==="hinge_flap")?.measurement.edgeDefects?.examples[0].incidentTriangles).toBe(4);
  expect(row.message).toContain("operations.0.waypoints.1");
  expect(row.message).toContain("base1 / flap1: INTERSECT");
  const judged=await judgeAssemblyCandidate({prompt:"两件式铰链，可拆卸",scad:scadSource});
  expect(judged.passed).toBe(false);
  expect(judged.diagnostics?.execution).toBe("COMPLETED");
  expect(judged.findings.join("\n")).toContain("Open, inconsistently oriented or non-manifold");
  expect(judged.findings.join("\n")).toContain("base1 / flap1: INTERSECT");
  expect(judged.evidence).toEqual([]);
},60000);

test("original two-part rigid stop allows an explicit rotate-then-withdraw release", async () => {
  const scadSource = await readFile("benchmarks/assembly/bayonet_retention.scad", "utf8");
  const artifacts = await renderAssemblyParts({ scadSource, parts: [{ partId: "support", selector: "support" }, { partId: "rotor", selector: "rotor" }, { partId: "all", selector: "all" }] });
  const parts = artifacts.filter(part => part.partId !== "all");
  const all = artifacts.find(part => part.partId === "all")!;
  expect(checkPartIdentity({ parts: parts.map(part => ({ ...part, selector: part.partId })), assemblyMesh: all }).status).toBe("PASS");
  const moving = parts.find(part => part.partId === "rotor")!.stl;
  const obstacles = { support: parts.find(part => part.partId === "support")!.stl };
  for (const part of parts) expect(checkPartConnectivity(part.stl).status).toBe("PASS");
  const workPoses = Array.from({ length: 19 }, (_, i) => rotationAboutAxis([0,0,0],[0,0,1],(-45+i*5)*Math.PI/180));
  const work = checkRigidPosePath({ moving, obstacles, poses: workPoses, maxTranslationStepMm: .25, maxRotationStepDeg: 5.001 });
  expect(work.status).toBe("PASS");
  for (const movingTransform of workPoses) {
    for (const sign of [-1,1]) {
      const held = checkTranslationProbe({ moving, obstacles, movingTransform, translationMm: [0,0,sign*4], samples: 33, expected: "blocked" });
      expect(held.status).toBe("PASS");
      expect(held.reason).not.toContain("starting pose");
    }
  }
  const poses = Array.from({ length: 19 }, (_, i) => rotationAboutAxis([0,0,0],[0,0,1],i*5*Math.PI/180));
  for (let i=1;i<=32;i++) { const pose=[...poses[18]]; pose[11]=i/8; poses.push(pose); }
  const release = checkRigidPosePath({ moving, obstacles, poses, maxTranslationStepMm: .25, maxRotationStepDeg: 5.001, requireSeparatedEnd: true });
  expect(release.status).toBe("PASS");
  expect(release.coverage).toContain("sampled");
  const reassembly = checkRigidPosePath({ moving, obstacles, poses: [...poses].reverse(), maxTranslationStepMm: .25, maxRotationStepDeg: 5.001 });
  expect(reassembly.status).toBe("PASS");
  // A reference-pose stop cannot certify retention at the release orientation.
  const unlocked = { moving, obstacles, movingTransform: poses[18], translationMm: [0,0,4] as [number,number,number], samples: 33 };
  expect(checkTranslationProbe({ ...unlocked, expected: "blocked" }).status).toBe("FAIL");
  expect(checkTranslationProbe({ ...unlocked, expected: "clear" }).status).toBe("PASS");
  // Direct extraction must fail even though the deliberately unlocked path clears.
  const direct = checkTranslationProbe({ moving, obstacles, translationMm: [0,0,4], samples: 33, expected: "clear" });
  expect(direct.status).toBe("FAIL");
  // Independent necessary fit bounds for the rectangular lug and slot.
  // For |angle| <= 45°, its X projection is >= 6*cos(45°), above the 2.6 mm slot.
  expect(6/Math.sqrt(2)).toBeGreaterThan(2.6);
  // At 90°, the 2 x 6 mm lug fits the centred 2.6 x 6.6 mm opening.
  expect(2).toBeLessThan(2.6); expect(6).toBeLessThan(6.6);
  // Exercise the same declaration path used by production verification/export,
  // reusing actual native meshes rather than replacing geometry with a mock.
  const spec = {
    schemaVersion:1,units:"mm",coordinateSystem:"right-handed",
    parts:parts.map(p=>({id:p.partId,name:p.partId,selector:p.partId,source:"generated",material:null})),
    instances:parts.map(p=>({id:p.partId,partId:p.partId,subassemblyId:null,transform:rotationAboutAxis([0,0,0],[0,0,1],0)})),
    subassemblies:[],connections:[],groundedInstanceId:"support",motions:[],operations:[
      {id:"remove_rotor",action:"disassemble",instanceId:"rotor",tools:[],waypoints:[],rigidTrajectory:{traversal:"forward",stages:[{type:"rotate",axis:{origin:[0,0,0],direction:[0,0,1]},angleDeg:90},{type:"translate",deltaMm:[0,0,4]}]}},
      {id:"insert_rotor",action:"assemble",instanceId:"rotor",tools:[],waypoints:[],rigidTrajectory:{traversal:"reverse",stages:[{type:"rotate",axis:{origin:[0,0,0],direction:[0,0,1]},angleDeg:90},{type:"translate",deltaMm:[0,0,4]}]}},
    ],manufacturing:null,assumptions:[],unknowns:[],
    translationProbes:workPoses.flatMap((startTransform,i)=>[-1,1].map((sign,j)=>({id:`hold${i}_${j}`,instanceId:"rotor",startTransform,translationMm:[0,0,sign*4],samples:33,expected:"blocked"}))),
  };
  const input = {scadSource,spec,assemblyMesh:all,render:async()=>({parts,purchasedPartIds:[]}),contractGate:{evidenceCurrent:false}};
  const prepared = await prepareAssembly(input);
  expect(prepared.manifest.translationProbes.measuredStatus).toBe("PASS");
  expect(prepared.manifest.translationProbes.status).toBe("NOT_RUN");
  expect(prepared.manifest.translationProbes.results).toHaveLength(38);
  expect(prepared.manifest.translationProbes.results.every(p=>p.status==="NOT_RUN"&&p.measuredStatus==="PASS")).toBe(true);
  expect(prepared.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
  expect(prepared.manifest.declaredAssembly.measuredStatus).toBe("PASS");
  expect(prepared.manifest.evidence.disassembly.status).toBe("NOT_RUN");
  expect(prepared.manifest.evidence.assemblyPath.status).toBe("NOT_RUN");
  const wrongOrder={...spec,operations:spec.operations.map(op=>({...op,rigidTrajectory:{...op.rigidTrajectory,stages:[...op.rigidTrajectory.stages].reverse()}}))};
  const wrong=await prepareAssembly({...input,spec:wrongOrder});
  expect(wrong.manifest.declaredDisassembly.measuredStatus).toBe("FAIL");
  expect(wrong.manifest.declaredAssembly.measuredStatus).toBe("FAIL");
  const bad = {...spec,translationProbes:[{...spec.translationProbes[1],id:"releaseMislabelledAsRetained",startTransform:poses[18]}]};
  const failed = await prepareAssembly({...input,spec:bad});
  expect(failed.manifest.translationProbes.status).toBe("FAIL");
  expect(failed.manifest.evidence.assembly.status).toBe("FAIL");
  expect(failed.manifest.evidence.physical.status).toBe("NOT_RUN");
}, 60000);

test("original gated hinge requires axial release before its sampled rotation and removal", async () => {
  const scadSource = await readFile("benchmarks/assembly/gated_bayonet_hinge.scad", "utf8");
  const artifacts = await renderAssemblyParts({ scadSource, parts: ["support", "rotor", "all"].map(id => ({ partId: id, selector: id })) });
  const parts = artifacts.filter(part => part.partId !== "all");
  const assemblyMesh = artifacts.find(part => part.partId === "all")!;
  const moving = parts.find(part => part.partId === "rotor")!.stl;
  const obstacles = { support: parts.find(part => part.partId === "support")!.stl };
  for (const part of parts) expect(checkPartConnectivity(part.stl).status).toBe("PASS");
  expect(checkPartIdentity({ parts: parts.map(part => ({ ...part, selector: part.partId })), assemblyMesh }).status).toBe("PASS");

  const pose = (angle: number, z = 0) => {
    const transform = rotationAboutAxis([0,0,0], [0,0,1], angle * Math.PI / 180);
    transform[11] = z;
    return transform;
  };
  const check = (poses: number[][], requireSeparatedEnd = false) => checkRigidPosePath({
    moving, obstacles, poses, maxTranslationStepMm: .25, maxRotationStepDeg: 5.001, requireSeparatedEnd,
  });
  const workPoses = Array.from({ length: 19 }, (_, i) => pose(-45 + i * 5));
  expect(check(workPoses).status).toBe("PASS");
  for (const movingTransform of workPoses) {
    for (const sign of [-1,1]) {
      const held = checkTranslationProbe({ moving, obstacles, movingTransform, translationMm: [0,0,sign * 4], samples: 33, expected: "blocked" });
      expect(held.status).toBe("PASS");
      expect(held.reason).not.toContain("starting pose");
    }
  }
  for (const sign of [-1,1]) {
    expect(check(Array.from({ length: 19 }, (_, i) => pose(sign * i * 5))).status).toBe("FAIL");
  }
  const release = [
    ...Array.from({ length: 7 }, (_, i) => pose(0, -.15 * i)),
    ...Array.from({ length: 18 }, (_, i) => pose((i + 1) * 5, -.9)),
    ...Array.from({ length: 44 }, (_, i) => pose(90, -.9 + (i + 1) * 10.9 / 44)),
  ];
  expect(check(release, true).status).toBe("PASS");
  expect(check([...release].reverse()).status).toBe("PASS");

  const stages = [
    { type: "translate", deltaMm: [0,0,-.9] },
    { type: "rotate", axis: { origin: [0,0,0], direction: [0,0,1] }, angleDeg: 90 },
    { type: "translate", deltaMm: [0,0,10.9] },
  ];
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: parts.map(part => ({ id: part.partId, name: part.partId, selector: part.partId, source: "generated", material: null })),
    instances: parts.map(part => ({ id: part.partId, partId: part.partId, subassemblyId: null, transform: pose(0) })),
    subassemblies: [], connections: [], groundedInstanceId: "support", motions: [],
    operations: [
      { id: "remove", action: "disassemble", instanceId: "rotor", tools: [], waypoints: [], rigidTrajectory: { traversal: "forward", stages } },
      { id: "insert", action: "assemble", instanceId: "rotor", tools: [], waypoints: [], rigidTrajectory: { traversal: "reverse", stages } },
    ],
    manufacturing: null, assumptions: [], unknowns: [],
  };
  const input = { scadSource, spec, assemblyMesh, render: async () => ({ parts, purchasedPartIds: [] }), contractGate: { evidenceCurrent: false } };
  const prepared = await prepareAssembly(input);
  expect(prepared.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
  expect(prepared.manifest.declaredAssembly.measuredStatus).toBe("PASS");
  expect(prepared.manifest.evidence.disassembly.status).toBe("NOT_RUN");
  expect(prepared.manifest.evidence.physical.status).toBe("NOT_RUN");
  const wrongOrder = { ...spec, operations: spec.operations.map(operation => ({
    ...operation, rigidTrajectory: { ...operation.rigidTrajectory, stages: [stages[1], stages[0], stages[2]] },
  })) };
  const wrong = await prepareAssembly({ ...input, spec: wrongOrder });
  expect(wrong.manifest.declaredDisassembly.measuredStatus).toBe("FAIL");
  expect(wrong.manifest.declaredAssembly.measuredStatus).toBe("FAIL");

  // Measure the lower guide independently of the release-path declaration.
  const guideSpec = { ...spec, connections: [{
    id: "guide", type: "revolute", a: "support", b: "rotor", boreInstanceId: "support",
    frameA: { origin: [0,0,0], direction: [0,0,1] },
    frameB: { origin: [0,0,0], direction: [0,0,1] },
    range: { min: -45, max: 45, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [],
  }] };
  const fit = measureRevoluteFit({ spec: guideSpec, connectionId: "guide", boreInstanceId: "support",
    meshes: Object.fromEntries(parts.map(part => [part.partId, part.stl])), stationsMm: [-1.75,-1.5,-1.25] });
  expect(fit.status).toBe("MEASURED");
  expect(fit.clearanceMm!.min).toBeGreaterThanOrEqual(.35);
  expect(fit.clearanceMm!.max).toBeLessThanOrEqual(.45);

  // Independently derived necessary vertical clearances for this rigid design.
  expect(5 - .9).toBeLessThan(4.2); // Handle passes below the gate overhang.
  expect(4 - .9).toBeGreaterThan(3); // Upper disk remains above the retention plate.
  // Source motion view is regenerated, while manufacturing selectors stay local.
  const [posed] = await renderAssemblyParts({ scadSource, parts: [{ partId: "pose", selector: "rotor_pose" }], parameters: { service_angle: 90, axial_shift: -.9 } });
  const bounds = meshBounds(readBinaryStl(posed.stl));
  expect(bounds.min[2]).toBeCloseTo(-3.9, 4);
  expect(bounds.max[1]).toBeCloseTo(5.8, 4);
}, 60000);

test("a provided mechanical scheme cannot hide a filled guide bore or a misplaced rotation gate", async () => {
  const original = await readFile("scripts/eval/assembly-fixtures/failures/guided-gated-hinge-2026-11-08.scad", "utf8");
  expect(createHash("sha256").update(original).digest("hex")).toBe("44ef9bc63e487059222980fccbf846821c1c028ce8477fbad34f03a5fa166999");
  const extracted = extractEmbeddedAssemblySpec(original);
  expect(extracted.status).toBe("valid");
  if (extracted.status !== "valid") throw new Error("Frozen declaration is invalid");
  expect(extracted.spec.translationProbes).toBeUndefined();
  const sectorAnchor = "    linear_extrude(height = z1 - z0)\n";
  const guideAnchor = "            translate([0, 0, 0])\n                cylinder(d = bore_d,";
  expect(original.split(sectorAnchor)).toHaveLength(2);
  expect(original.split(guideAnchor)).toHaveLength(2);
  const guideFixed = original.replace(guideAnchor,
    "            translate([0, 0, (bot_plate_z0 + bot_plate_z1)/2])\n                cylinder(d = bore_d,");
  const bothFixed = guideFixed.replace(sectorAnchor, "    translate([0, 0, z0])\n" + sectorAnchor);
  const results: Array<{
    fit: ReturnType<typeof measureRevoluteFit>;
    work: ReturnType<typeof checkRigidPosePath>;
    direct: ReturnType<typeof checkRigidPosePath>;
    release: ReturnType<typeof checkRigidPosePath>;
    assembly: ReturnType<typeof checkRigidPosePath>;
  }> = [];
  for (const source of [original, guideFixed, bothFixed]) {
    const parts = await renderAssemblyParts({ scadSource: source, parts: extracted.spec.parts.map(part => ({ partId: part.id, selector: part.selector })) });
    const meshes = Object.fromEntries(parts.map(part => [part.partId, part.stl]));
    for (const part of parts) expect(checkPartConnectivity(part.stl).status).toBe("PASS");
    const fit = measureRevoluteFit({ spec: extracted.spec, connectionId: "hinge", boreInstanceId: "a1", meshes, stationsMm: [-1.75,-1.5,-1.25] });
    const pose = (angle: number, z = 0) => {
      const matrix = rotationAboutAxis([0,0,0], [0,0,1], angle * Math.PI / 180);
      matrix[11] = z;
      return matrix;
    };
    const check = (poses: number[][], requireSeparatedEnd = false) => checkRigidPosePath({
      moving: meshes.rotorB, obstacles: { supportA: meshes.supportA }, poses,
      maxTranslationStepMm: .25, maxRotationStepDeg: 5.001, requireSeparatedEnd,
    });
    const release = [
      ...Array.from({ length: 7 }, (_, i) => pose(0, -.15 * i)),
      ...Array.from({ length: 18 }, (_, i) => pose((i + 1) * 5, -.9)),
      ...Array.from({ length: 44 }, (_, i) => pose(90, -.9 + (i + 1) * 10.9 / 44)),
    ];
    results.push({ fit, work: check(Array.from({ length: 19 }, (_, i) => pose(-45 + i * 5))),
      direct: check(Array.from({ length: 19 }, (_, i) => pose(i * 5))),
      release: check(release, true), assembly: check([...release].reverse()) });
  }
  const [raw, guideOnly, corrected] = results;
  expect(raw.fit.status).toBe("ERROR");
  expect(raw.fit.reason).toContain("centre is INSIDE");
  expect(raw.work.status).toBe("FAIL");
  expect(raw.release.status).toBe("FAIL");
  for (const result of [guideOnly, corrected]) {
    expect(result.fit.status).toBe("MEASURED");
    expect(result.fit.clearanceMm!.min).toBeGreaterThanOrEqual(.35);
    expect(result.fit.clearanceMm!.max).toBeLessThanOrEqual(.45);
    expect(result.work.status).toBe("PASS");
    expect(result.release.status).toBe("PASS");
    expect(result.assembly.status).toBe("PASS");
  }
  expect(guideOnly.direct.status).toBe("PASS");
  expect(corrected.direct.status).toBe("FAIL");
}, 90000);
