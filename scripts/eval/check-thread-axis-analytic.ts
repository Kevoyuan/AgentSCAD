#!/usr/bin/env bun
/** Independent, synthetic falsification of an exploratory estimator. No CAD or model call. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { exploreThreadAxis, exploreThreadCoaxiality } from "../../src/lib/assembly/thread-axis-prototype";

type Vector2 = [number, number];
type Shape = {radius:number; segments:number; center:Vector2; slope:Vector2};
type Case = {id:string; a:Shape; b:Shape};
type Protocol = {stationsMm:number[]; referenceZMm:number; errorBoundsForThisExperimentOnly:{offsetMm:number; angleDeg:number}; cases:Case[]};
type Point = [number,number,number];
const hash=(data:Buffer)=>createHash("sha256").update(data).digest("hex");

// Explicit polygonal mesh generator; it shares no geometry code with the estimator.
function cylinder(s:Shape,referenceZ:number):Buffer {
  const triangles:Array<[Point,Point,Point]>=[];
  const vertex=(i:number,z:number):Point=>{
    const theta=2*Math.PI*i/s.segments;
    return [s.center[0]+s.slope[0]*(z-referenceZ)+s.radius*Math.cos(theta),
      s.center[1]+s.slope[1]*(z-referenceZ)+s.radius*Math.sin(theta),z];
  };
  const center=(z:number):Point=>[s.center[0]+s.slope[0]*(z-referenceZ),s.center[1]+s.slope[1]*(z-referenceZ),z];
  for(let i=0;i<s.segments;i++) {
    const j=(i+1)%s.segments, a=vertex(i,0), b=vertex(j,0), c=vertex(i,10), d=vertex(j,10);
    triangles.push([a,b,d],[a,d,c],[center(0),b,a],[center(10),c,d]);
  }
  const stl=Buffer.alloc(84+50*triangles.length);stl.writeUInt32LE(triangles.length,80);
  triangles.forEach((triangle,i)=>triangle.forEach((point,j)=>point.forEach((n,k)=>stl.writeFloatLE(n,84+50*i+12+12*j+4*k))));
  return stl;
}
function truth(a:Shape,b:Shape) {
  const x=[...a.slope,1],y=[...b.slope,1];
  const cos=x.reduce((sum,v,i)=>sum+v*y[i],0)/(Math.hypot(...x)*Math.hypot(...y));
  return {offsetMm:Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1]),angleDeg:Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI};
}
async function main() {
  const protocolPath="scripts/eval/assembly-fixtures/thread-axis-analytic-protocol.json";
  const [protocolBytes,algorithm,script]=await Promise.all([readFile(protocolPath),readFile("src/lib/assembly/thread-axis-prototype.ts"),readFile("scripts/eval/check-thread-axis-analytic.ts")]);
  const protocol=JSON.parse(protocolBytes.toString()) as Protocol;
  const experimentRoot=".agentscad/experiments";await mkdir(experimentRoot,{recursive:true});
  const directory=await mkdtemp(path.join(experimentRoot,"thread-axis-analytic-"));
  const results:unknown[]=[];
  for(const item of protocol.cases) {
    const a=cylinder(item.a,protocol.referenceZMm),b=cylinder(item.b,protocol.referenceZMm);
    await Promise.all([writeFile(path.join(directory,`${item.id}-a.stl`),a),writeFile(path.join(directory,`${item.id}-b.stl`),b)]);
    const aFit=exploreThreadAxis(a,protocol.stationsMm),bFit=exploreThreadAxis(b,protocol.stationsMm);
    const comparison=exploreThreadCoaxiality(aFit,bFit),expected=truth(item.a,item.b);
    const errors=typeof comparison.offsetEstimateMm === "number" && typeof comparison.angleEstimateDeg === "number"
      ? {offsetMm:Math.abs(comparison.offsetEstimateMm-expected.offsetMm),angleDeg:Math.abs(comparison.angleEstimateDeg-expected.angleDeg)} : null;
    results.push({id:item.id,inputSha256:{a:hash(a),b:hash(b)},truth:expected,comparison,errors,
      withinExperimentOnlyBounds:errors ? errors.offsetMm<=protocol.errorBoundsForThisExperimentOnly.offsetMm && errors.angleDeg<=protocol.errorBoundsForThisExperimentOnly.angleDeg : null});
  }
  const report={status:"NOT_RUN",reason:"Synthetic experiments do not establish thread feature identity, uncertainty bounds, or real assembly coaxiality.",protocolSha256:hash(protocolBytes),algorithmSha256:hash(algorithm),scriptSha256:hash(script),results};
  await Promise.all([writeFile(path.join(directory,"protocol.json"),protocolBytes),writeFile(path.join(directory,"algorithm.ts"),algorithm),writeFile(path.join(directory,"experiment.ts"),script),writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2))]);
  console.log(JSON.stringify({directory,...report},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=2;});
