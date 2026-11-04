#!/usr/bin/env bun
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { checkRigidPosePath } from "../../src/lib/assembly/rigid-pose-path";
import { quarterTurnPath } from "./assembly-fixtures/quarter-turn-paths";

async function main() {
  const scadSource=await readFile(process.argv[2] ?? "benchmarks/assembly/quarter_turn_capture.scad","utf8");
  const root=path.resolve(".agentscad/experiments");await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,"quarter-turn-"));
  const parts=await renderAssemblyParts({scadSource,parameters:{agentscad_pose:true,lock_angle:90},parts:[{partId:"pin",selector:"pin"},{partId:"sleeve",selector:"sleeve"}]});
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const options={moving:meshes.pin,obstacles:{sleeve:meshes.sleeve},maxTranslationStepMm:0.151,maxRotationStepDeg:5.001};
  if(process.argv[3] && process.argv[3]!=="push")throw new Error("Only the push fixture mode is supported");
  const liftMm=process.argv[3]==="push"?1:0;
  const releasePath=quarterTurnPath(-90,liftMm);
  const release=checkRigidPosePath({...options,poses:releasePath,requireSeparatedEnd:true});
  const assemble=checkRigidPosePath({...options,poses:[...releasePath].reverse()});
  const straight=checkRigidPosePath({...options,poses:quarterTurnPath(0),requireSeparatedEnd:true});
  const wrongAngle=checkRigidPosePath({...options,poses:quarterTurnPath(-45,liftMm),requireSeparatedEnd:true});
  const noPush=liftMm>0?checkRigidPosePath({...options,poses:quarterTurnPath(-90),requireSeparatedEnd:true}):null;
  await writeFile(path.join(directory,"source.scad"),scadSource);
  await writeFile(path.join(directory,"render-parameters.json"),JSON.stringify({agentscad_pose:true,lock_angle:90}));
  for(const p of parts)await writeFile(path.join(directory,`${p.partId}.stl`),p.stl);
  await writeFile(path.join(directory,"report.json"),JSON.stringify({release,assemble,straight,wrongAngle,noPush,physical:{status:"NOT_RUN"}},null,2));
  console.log(JSON.stringify({directory,release:release.status,assemble:assemble.status,straight:straight.status,wrongAngle:wrongAngle.status,noPush:noPush?.status,poses:release.posesEvaluated,translationStepMm:release.translationStepMm,rotationStepDeg:release.rotationStepDeg},null,2));
  process.exitCode=release.status==='PASS'&&assemble.status==='PASS'&&straight.status==='FAIL'&&wrongAngle.status==='FAIL'&&(noPush===null||noPush.status==='FAIL')?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
