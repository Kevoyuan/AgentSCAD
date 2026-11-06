#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {generateThreadReference,type ThreadReferenceGeometry} from "./generated-thread-reference";
import {exploreThreadAxis} from "../../src/lib/assembly/thread-axis-prototype";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");

async function main() {
  const bytes=await readFile(process.argv[2]??"scripts/eval/assembly-fixtures/thread-axis-generated-protocol.json");
  const protocol=JSON.parse(bytes.toString()) as {geometry:ThreadReferenceGeometry;angularMultipliers:number[];layersPerMm:number[];phaseDeg:number[];stationsMm:number[][];circleFit?:"three-point"|"least-squares-support"};
  await mkdir(".agentscad/experiments",{recursive:true});
  const directory=await mkdtemp(path.join(".agentscad/experiments","generated-thread-axis-"));
  const results:Array<Record<string,unknown>>=[];
  const meshes:Array<Record<string,unknown>>=[];
  for(const angular of protocol.angularMultipliers) for(const axial of protocol.layersPerMm) for(const phase of protocol.phaseDeg) {
    const id=`angular-${angular}-axial-${axial}-phase-${phase}`;
    const generated=generateThreadReference(protocol.geometry,angular,axial,phase);
    const meshSha256=sha(generated.stl);
    await writeFile(path.join(directory,`${id}.stl`),generated.stl);
    meshes.push({id,angular,axial,phase,meshSha256,triangleCount:generated.triangleCount,vertexCount:generated.vertexCount,layers:generated.layers,angularNodes:generated.angularNodes});
    for(const stations of protocol.stationsMm) {
      const fit=exploreThreadAxis(generated.stl,stations,{seedMm:protocol.geometry.centerMm,role:"bore",sampling:"enclosing-contour-endpoints",circleFit:protocol.circleFit});
      const axis="axis" in fit?fit.axis:undefined;
      const error=axis?{offsetMm:Math.hypot(axis.point[0]-protocol.geometry.centerMm[0],axis.point[1]-protocol.geometry.centerMm[1]),angleDeg:Math.atan(Math.hypot(...axis.slope))*180/Math.PI}:null;
      results.push({id,angular,axial,phase,stationsMm:stations,meshSha256,error,fit});
    }
  }
  const files=["scripts/eval/check-generated-thread-axis.ts","scripts/eval/generated-thread-reference.ts","src/lib/assembly/thread-axis-prototype.ts","src/lib/assembly/slider-crank-motion.ts","src/lib/geometry/stl-mesh.ts","src/lib/geometry/section-contours.ts","src/lib/geometry/mesh-collision.ts"];
  const codeHashes:Record<string,string>={};
  for(const file of files) {
    const source=await readFile(file);codeHashes[file]=sha(source);
    await writeFile(path.join(directory,path.basename(file)),source);
  }
  const report={status:"NOT_RUN",scope:"Finite independent construction-reference study. Not a calibrated global or physical error bound.",protocolSha256:sha(bytes),codeHashes,meshes,results};
  await Promise.all([writeFile(path.join(directory,"protocol.json"),bytes),writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2))]);
  console.log(JSON.stringify({directory,protocolSha256:report.protocolSha256,results:results.map(({id,stationsMm,error,fit})=>({id,stationsMm,error,reason:(fit as ReturnType<typeof exploreThreadAxis>).reason}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=2;});
