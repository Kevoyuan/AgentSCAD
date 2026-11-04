#!/usr/bin/env bun
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { buildAssemblyBundle } from "../../src/lib/assembly/assembly-bundle";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { checkReconstructedMesh } from "../../src/lib/assembly/reconstructed-mesh-check";

async function main() {
  const source=await readFile(process.argv[2] ?? "benchmarks/assembly/slider_crank_keyed.scad","utf8");
  const embedded=extractEmbeddedAssemblySpec(source);
  if(embedded.status!=="valid")throw new Error("Missing valid embedded specification");
  const bundle=await buildAssemblyBundle({scadSource:source,spec:embedded.spec,contractGate:{evidenceCurrent:false,reason:"Experimental candidate, not a user-confirmed requirement contract"}});
  const root=path.resolve(".agentscad/experiments");await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,"keyed-export-"));
  await writeFile(path.join(directory,"source.scad"),source);
  await writeFile(path.join(directory,"assembly.zip"),bundle.zip);
  // Reconstruct from archive bytes, not the builder's in-memory mesh objects.
  const files=unzipSync(bundle.zip);
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  // These original fixtures expose instance IDs as selectors when pose mode is on.
  // Manufacturing exports still use the part selectors from the manifest.
  const posed=await renderAssemblyParts({scadSource:source,parts:embedded.spec.instances.map(i=>({partId:i.id,selector:i.id})),parameters:{agentscad_pose:true,motion_angle:0}});
  const results=manifest.instances.map((instance:{id:string;partId:string;transform:number[]})=>{
    const part=manifest.parts.find((p:{id:string})=>p.id===instance.partId);
    const actual=posed.find(p=>p.partId===instance.id)!;
    return {instanceId:instance.id,...checkReconstructedMesh({local:Buffer.from(files[part.fileName]),posed:actual.stl,transform:instance.transform})};
  });
  const rod=manifest.instances.find((i:{id:string})=>i.id==='rod');
  const rodPart=manifest.parts.find((p:{id:string})=>p.id==='rod');
  const bad=[...rod.transform];bad[11]+=1;
  const wrongTransform=checkReconstructedMesh({local:Buffer.from(files[rodPart.fileName]),posed:posed.find(p=>p.partId==='rod')!.stl,transform:bad});
  for(const p of posed)await writeFile(path.join(directory,`${p.partId}-posed.stl`),p.stl);
  // The declared path is checked against the archive's own local meshes, so a
  // stale in-memory render cannot pass where the exported bytes would not.
  const declaredPath = checkDeclaredPoseDisassembly({
    spec: embedded.spec,
    meshes: Object.fromEntries(manifest.parts.map((p: { id: string; fileName: string }) => [p.id, Buffer.from(files[p.fileName])])),
  });
  const report={declaredPath,bundleSha256:bundle.sha256,results,wrongTransform,contract:manifest.contract,physical:{status:"NOT_RUN"}};
  await writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({directory,results,wrongTransform,declaredPathStatus:declaredPath.status},null,2));
  process.exitCode=results.every((r:{status:string})=>r.status==='PASS')&&wrongTransform.status==='FAIL'&&declaredPath.status==='PASS'?0:2;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
