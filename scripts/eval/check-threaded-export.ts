#!/usr/bin/env bun
/** Exercise actual bundle bytes at the zero-turn assembled pose. */
import { readFile,writeFile,mkdir,mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { unzipSync,strFromU8 } from "fflate";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { buildAssemblyBundle } from "../../src/lib/assembly/assembly-bundle";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { checkReconstructedMesh } from "../../src/lib/assembly/reconstructed-mesh-check";

async function main() {
  const source=await readFile("benchmarks/assembly/threaded_fastener.scad","utf8");
  const declaration=extractEmbeddedAssemblySpec(source);
  if(declaration.status!=="valid")throw new Error("Invalid embedded assembly specification");
  const bundle=await buildAssemblyBundle({scadSource:source,spec:declaration.spec,contractGate:{evidenceCurrent:false,reason:"Experimental fixture has no user-confirmed contract."}});
  const zip=unzipSync(bundle.zip);
  const manifest=JSON.parse(strFromU8(zip["manifest.json"]));
  const posed=await renderAssemblyParts({scadSource:source,parts:declaration.spec.parts.map(p=>({partId:p.id,selector:p.selector})),parameters:{agentscad_pose:true,turn_deg:0}});
  const results=manifest.instances.map((i:{id:string;partId:string;transform:number[]})=>{
    const file=manifest.parts.find((p:{id:string})=>p.id===i.partId).fileName;
    const mesh=posed.find(p=>p.partId===i.partId)!.stl;
    return {instanceId:i.id,...checkReconstructedMesh({local:Buffer.from(zip[file]),posed:mesh,transform:i.transform})};
  });
  const nut=manifest.instances.find((i:{id:string})=>i.id==='nut');
  const displaced=[...nut.transform]; displaced[11]+=1;
  const negative=checkReconstructedMesh({local:Buffer.from(zip['nut.stl']),posed:posed.find(p=>p.partId==='nut')!.stl,transform:displaced});
  const root=path.resolve('.agentscad/experiments');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'thread-export-'));
  await writeFile(path.join(directory,'source.scad'),source);
  await writeFile(path.join(directory,'assembly.zip'),bundle.zip);
  for(const p of posed)await writeFile(path.join(directory,`${p.partId}-posed.stl`),p.stl);
  const report={sourceSha256:createHash('sha256').update(source).digest('hex'),bundleSha256:bundle.sha256,results,negative,contract:manifest.contract,evidence:manifest.evidence,physical:{status:'NOT_RUN'}};
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({directory,results,negative,evidence:manifest.evidence},null,2));
  process.exitCode=results.every((r:{status:string})=>r.status==='PASS')&&negative.status==='FAIL'&&manifest.evidence.disassembly.status==='NOT_RUN'?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=2;});
