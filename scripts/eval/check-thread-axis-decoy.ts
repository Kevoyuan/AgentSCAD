#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exploreThreadAxis } from "../../src/lib/assembly/thread-axis-prototype";
type Point=[number,number,number];
type Geometry={outerRadiusMm:number;outerSegments:number;outerCenterMm:[number,number];boreRadiusMm:number;boreSegments:number;boreCenterMm:[number,number];heightMm:number};
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
function annulus(g:Geometry) {
  if(g.outerSegments%g.boreSegments!==0)throw new Error("Outer resolution must be a multiple of bore resolution");
  const multiple=g.outerSegments/g.boreSegments;
  const circle=(r:number,n:number,c:[number,number],i:number,z:number):Point=>[c[0]+r*Math.cos(2*Math.PI*i/n),c[1]+r*Math.sin(2*Math.PI*i/n),z];
  const outside=(i:number,z:number)=>circle(g.outerRadiusMm,g.outerSegments,g.outerCenterMm,i,z);
  // Subdivide straight bore polygon edges to match outer surface and cap topology.
  const inside=(i:number,z:number):Point=>{
    const k=Math.floor(i/multiple),t=(i%multiple)/multiple;
    const a=circle(g.boreRadiusMm,g.boreSegments,g.boreCenterMm,k,z),b=circle(g.boreRadiusMm,g.boreSegments,g.boreCenterMm,k+1,z);
    return [a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t,z];
  };
  const faces:Array<[Point,Point,Point]>=[];
  for(let i=0;i<g.outerSegments;i++) {
    const j=(i+1)%g.outerSegments,o=outside(i,0),p=outside(j,0),O=outside(i,g.heightMm),P=outside(j,g.heightMm);
    const b=inside(i,0),c=inside(j,0),B=inside(i,g.heightMm),C=inside(j,g.heightMm);
    faces.push([o,p,P],[o,P,O],[b,C,c],[b,B,C],[o,c,p],[o,b,c],[O,P,C],[O,C,B]);
  }
  const result=Buffer.alloc(84+50*faces.length);result.writeUInt32LE(faces.length,80);
  faces.forEach((f,i)=>f.forEach((p,j)=>p.forEach((v,k)=>result.writeFloatLE(v,84+50*i+12+12*j+4*k))));
  return result;
}
async function main() {
  const [protocolBytes,algorithm,script]=await Promise.all([readFile("scripts/eval/assembly-fixtures/thread-axis-decoy-protocol.json"),readFile("src/lib/assembly/thread-axis-prototype.ts"),readFile("scripts/eval/check-thread-axis-decoy.ts")]);
  const protocol=JSON.parse(protocolBytes.toString()) as {geometry:Geometry;stationOffsetsMm:number[]};
  const mesh=annulus(protocol.geometry),fit=exploreThreadAxis(mesh,protocol.stationOffsetsMm);
  const axis="axis" in fit?fit.axis:undefined;
  const distance=(c:[number,number])=>axis?Math.hypot(axis.point[0]-c[0],axis.point[1]-c[1]):null;
  const report={status:"NOT_RUN",note:"A circular fit does not identify the intended feature; no assembly verdict.",protocolSha256:sha(protocolBytes),algorithmSha256:sha(algorithm),scriptSha256:sha(script),meshSha256:sha(mesh),fit,distanceToBoreMm:distance(protocol.geometry.boreCenterMm),distanceToOuterMm:distance(protocol.geometry.outerCenterMm)};
  const root=".agentscad/experiments";await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,"thread-axis-decoy-"));
  await Promise.all([writeFile(path.join(directory,"mesh.stl"),mesh),writeFile(path.join(directory,"protocol.json"),protocolBytes),writeFile(path.join(directory,"algorithm.ts"),algorithm),writeFile(path.join(directory,"experiment.ts"),script),writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2))]);
  console.log(JSON.stringify({directory,...report},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=2;});
