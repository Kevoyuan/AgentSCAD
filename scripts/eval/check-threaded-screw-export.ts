#!/usr/bin/env bun
/** Native, original-fixture regression of the parameterized removal export path.
 * The trajectory below is an explicit experimental declaration, not verified
 * thread engagement or a replacement for the source's embedded declaration. */
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { buildAssemblyBundle } from "../../src/lib/assembly/assembly-bundle";
import { usesOpenScadWasm } from "../../src/lib/tools/openscad-backend";

async function main() {
  const source=await readFile("benchmarks/assembly/threaded_fastener.scad","utf8");
  const parsed=extractEmbeddedAssemblySpec(source);
  if(parsed.status!=="valid")throw new Error("Invalid embedded assembly specification");
  const spec={...parsed.spec,operations:[{id:"remove_nut",action:"disassemble" as const,instanceId:"nut",tools:[],waypoints:[],
    screwTrajectory:{axis:{origin:[0,0,0] as [number,number,number],direction:[0,0,1] as [number,number,number]},
      hand:"right" as const,leadMm:1.5,startAngleDeg:0,endAngleDeg:4320}}]};
  const bundle=await buildAssemblyBundle({scadSource:source,spec,contractGate:{evidenceCurrent:false,reason:"Experimental trajectory was not user-confirmed."}});
  const manifest=JSON.parse(strFromU8(unzipSync(bundle.zip)["manifest.json"]));
  const root=path.resolve(".agentscad/experiments"); await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,"screw-declaration-export-"));
  const report={backend:usesOpenScadWasm()?"wasm":"native",sourceSha256:createHash("sha256").update(source).digest("hex"),bundleSha256:bundle.sha256,
    specificationSha256:manifest.specificationSha256,disassembly:manifest.declaredDisassembly,evidence:manifest.evidence,
    physical:{status:"NOT_RUN"},scope:"Native per-part render; ideal sampled path only. No thread engagement, continuous path or physical function is verified."};
  await Promise.all([writeFile(path.join(directory,"source.scad"),source),writeFile(path.join(directory,"spec.json"),JSON.stringify(spec,null,2)),
    writeFile(path.join(directory,"assembly.zip"),bundle.zip),writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2))]);
  console.log(JSON.stringify({directory,sourceSha256:report.sourceSha256,bundleSha256:report.bundleSha256,
    specificationSha256:report.specificationSha256,status:manifest.declaredDisassembly.status,
    reason:manifest.declaredDisassembly.results[0]?.reason,
    sampledPoses:manifest.declaredDisassembly.results[0]?.path?.poses?.length,
    posesEvaluated:manifest.declaredDisassembly.results[0]?.path?.posesEvaluated,
    gatedStatus:manifest.evidence.disassembly.status},null,2));
  if(manifest.declaredDisassembly.specificationSha256!==manifest.specificationSha256 || manifest.evidence.disassembly.status!=="NOT_RUN")process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=2;});
