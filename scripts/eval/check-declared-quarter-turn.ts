#!/usr/bin/env bun
import { readFile,writeFile,mkdir,mkdtemp } from "node:fs/promises";
import path from "node:path";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { renderAssemblySpecParts } from "../../src/lib/tools/assembly-part-renderer";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { multiplyMatrices } from "../../src/lib/assembly/path-and-motion";
import { quarterTurnPath } from "./assembly-fixtures/quarter-turn-paths";
async function main() {
  const source=await readFile("benchmarks/assembly/quarter_turn_seated.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  if(embedded.status!=="valid")throw new Error("Source lacks a valid assembly declaration");
  const {parts}=await renderAssemblySpecParts(source,embedded.spec);
  const meshes=Object.fromEntries(parts.map(p=>[p.partId,p.stl]));
  const declared=checkDeclaredPoseDisassembly({spec:embedded.spec,meshes});
  const noLiftSpec=structuredClone(embedded.spec);
  const start=noLiftSpec.instances.find(i=>i.id==='pin')!.transform;
  noLiftSpec.operations[0].waypoints=quarterTurnPath(-90).map(p=>multiplyMatrices(p,start)) as typeof noLiftSpec.operations[0]['waypoints'];
  const noLift=checkDeclaredPoseDisassembly({spec:noLiftSpec,meshes});
  const root=path.resolve(".agentscad/experiments");await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,"declared-quarter-turn-"));
  await writeFile(path.join(directory,"source.scad"),source);
  await writeFile(path.join(directory,"negative-spec.json"),JSON.stringify(noLiftSpec,null,2));
  for(const p of parts)await writeFile(path.join(directory,`${p.partId}-local.stl`),p.stl);
  await writeFile(path.join(directory,"report.json"),JSON.stringify({declared,noLift},null,2));
  console.log(JSON.stringify({directory,declared:declared.status,noLift:noLift.status,poses:declared.results[0]?.path?.posesEvaluated},null,2));
  process.exitCode=declared.status==='PASS'&&noLift.status==='FAIL'?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
