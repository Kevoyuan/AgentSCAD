#!/usr/bin/env bun
import { readFile,writeFile,mkdir,mkdtemp } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { sampleThreadedFastener } from "../../src/lib/tools/thread-measurement";
import { checkThreadExit } from "../../src/lib/assembly/thread-exit";
import { measurementExitCode } from "../../src/lib/assembly/measurement-status";

// Local OpenSCAD experiment. Every pose is actually rendered; no assumed
// stationary-bolt shortcut or model/provider call is used.
async function main() {
  const scadSource=await readFile("benchmarks/assembly/threaded_fastener.scad","utf8");
  const rawSetup=await readFile("scripts/eval/assembly-fixtures/threaded-fastener-exit.json","utf8");
  const setup=JSON.parse(rawSetup);
  const root=path.resolve(".agentscad/experiments");await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,"thread-exit-"));
  await Promise.all([writeFile(path.join(directory,"source.scad"),scadSource),writeFile(path.join(directory,"setup.json"),rawSetup)]);
  // Preserve the implementation used for this run: HEAD alone does not describe
  // a dirty workspace and cannot reproduce its measurements.
  const verifierPaths=["src/lib/tools/thread-measurement.ts","src/lib/assembly/thread-motion.ts","src/lib/assembly/thread-geometry.ts","src/lib/assembly/thread-exit.ts","src/lib/geometry/mesh-collision.ts","src/lib/geometry/stl-mesh.ts"];
  const verifierDir=path.join(directory,"verifier");await mkdir(verifierDir,{recursive:true});
  const verifierSha256:Record<string,string>={};
  for(const sourcePath of verifierPaths){const data=await readFile(sourcePath);const name=sourcePath.replaceAll("/","__");await writeFile(path.join(verifierDir,name),data);verifierSha256[sourcePath]=createHash("sha256").update(data).digest("hex");}
  let openscadVersion="unavailable";
  const versionResult=spawnSync(process.env.OPENSCAD_BIN || "openscad",["--version"],{encoding:"utf8",timeout:5000});
  if(versionResult.status===0) openscadVersion=[versionResult.stdout,versionResult.stderr].filter(Boolean).join("\n").trim() || "unavailable";
  await writeFile(path.join(directory,"provenance.json"),JSON.stringify({verifierSha256,openscadVersion,bunVersion:(process.versions as Record<string,string>).bun??null,backend:process.env.AGENTSCAD_OPENSCAD_BACKEND??"auto"},null,2));
  const firstPoses:Array<{turnDeg:number;bolt:Buffer;nut:Buffer}>=[];
  console.log(JSON.stringify({directory,message:"Starting 49 independently rendered poses; local OpenSCAD only."}));
  const report=await sampleThreadedFastener({...setup,scadSource,onArtifacts:async(label,parts)=>{
    for(const part of parts)await writeFile(path.join(directory,`${label}-${part.partId}.stl`),part.stl);
    if(label.startsWith("turn-")) {
      const angle=Number(label.slice(5));
      if(firstPoses.length<9)firstPoses.push({turnDeg:angle,bolt:parts.find(p=>p.partId==='bolt')!.stl,nut:parts.find(p=>p.partId==='nut')!.stl});
      console.log(JSON.stringify({completedRender:angle}));
    }
  }});
  const short=checkThreadExit({...setup.exit,poses:firstPoses.map((pose,i)=>({...pose,collision:report.engagement.poses[i].status as "SEPARATED"|"INTERSECT"|"CONTAINED"|"UNKNOWN"|"ERROR"}))});
  await writeFile(path.join(directory,"report.json"),JSON.stringify({report,short},null,2));
  console.log(JSON.stringify({directory,status:report.status,exit:report.exit.status,short:short.status,poses:report.engagement.poses.length}));
  process.exitCode=short.status==='FAIL'?measurementExitCode(report.status):3;
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=2;});
