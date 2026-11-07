import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderAssemblyParts } from "../assembly-part-renderer";
import { checkTranslationProbe } from "../../assembly/translation-probe";
import { checkRigidPosePath } from "../../assembly/rigid-pose-path";
import { rotationAboutAxis } from "../../assembly/path-and-motion";
import { checkPartConnectivity } from "../../assembly/part-connectivity";
import { checkPartIdentity } from "../../assembly/part-identity-check";
import { prepareAssembly } from "../../assembly/prepare-assembly";
import { extractEmbeddedAssemblySpec } from "../../assembly/embedded-spec";
import { buildBvh, placeBvh, bvhIntersects } from "../../geometry/mesh-collision";
import { readBinaryStl } from "../../geometry/stl-mesh";
import {validateAssemblyArtifact} from "../../validation/assembly-validation";
import {judgeAssemblyCandidate} from "../../../../scripts/eval/judge-assembly";

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
    subassemblies:[],connections:[],groundedInstanceId:"support",motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[],
    translationProbes:workPoses.flatMap((startTransform,i)=>[-1,1].map((sign,j)=>({id:`hold${i}_${j}`,instanceId:"rotor",startTransform,translationMm:[0,0,sign*4],samples:33,expected:"blocked"}))),
  };
  const input = {scadSource,spec,assemblyMesh:all,render:async()=>({parts,purchasedPartIds:[]}),contractGate:{evidenceCurrent:false}};
  const prepared = await prepareAssembly(input);
  expect(prepared.manifest.translationProbes.measuredStatus).toBe("PASS");
  expect(prepared.manifest.translationProbes.status).toBe("NOT_RUN");
  expect(prepared.manifest.translationProbes.results).toHaveLength(38);
  expect(prepared.manifest.translationProbes.results.every(p=>p.status==="NOT_RUN"&&p.measuredStatus==="PASS")).toBe(true);
  const bad = {...spec,translationProbes:[{...spec.translationProbes[1],id:"releaseMislabelledAsRetained",startTransform:poses[18]}]};
  const failed = await prepareAssembly({...input,spec:bad});
  expect(failed.manifest.translationProbes.status).toBe("FAIL");
  expect(failed.manifest.evidence.assembly.status).toBe("FAIL");
  expect(failed.manifest.evidence.physical.status).toBe("NOT_RUN");
}, 60000);
