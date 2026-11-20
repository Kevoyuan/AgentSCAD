#!/usr/bin/env bun
/** Zero-model-cost, frozen synthetic probes; raw station/axis evidence retained. */
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {prismStl} from "../../src/lib/geometry/__tests__/prism";
import {tubeStl} from "../../src/lib/geometry/__tests__/solids";
import {measureRevoluteFit} from "../../src/lib/assembly/fit-measurement";
import {checkMeasuredJointFrames} from "../../src/lib/assembly/measured-joint-frame";
const sha=(x:Buffer|string)=>createHash("sha256").update(x).digest("hex");

async function main() {
  const protocolBytes=await fs.readFile("scripts/eval/assembly-fixtures/joint-frame-consistency-protocol.json");
  const protocol=JSON.parse(protocolBytes.toString());
  const directory=await fs.mkdtemp(".agentscad/experiments/joint-frame-consistency-");
  await fs.writeFile(`${directory}/protocol.json`,protocolBytes);
  const codeFiles=["scripts/eval/check-joint-frame-consistency.ts","src/lib/assembly/measured-joint-frame.ts","src/lib/assembly/fit-measurement.ts","src/lib/geometry/cylindrical-feature.ts","src/lib/geometry/__tests__/prism.ts","src/lib/geometry/__tests__/solids.ts"];
  const hashes:Record<string,string>={};
  for(const file of codeFiles){const source=await fs.readFile(file);hashes[file]=sha(source);await fs.writeFile(`${directory}/${file.replaceAll("/","__")}`,source);}
  const specBytes=await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge.spec.json");
  await fs.writeFile(`${directory}/base-specification.json`,specBytes);
  const base={fixed:prismStl({radius:3,height:12,z0:-1,segments:64}),moving:tubeStl({outerRadius:5,innerRadius:3.2,height:10,segments:64})};
  for(const [id,bytes] of Object.entries(base))await fs.writeFile(`${directory}/base-${id}.stl`,bytes);
  const results:Array<{probe:{id:string};spec:unknown;meshHashes:Record<string,string>;measurement:ReturnType<typeof measureRevoluteFit>;frames:ReturnType<typeof checkMeasuredJointFrames>;expectedStatusMatched:boolean}>=[];
  for(const probe of protocol.cases) {
    const spec=JSON.parse(specBytes.toString());
    if(probe.worldQuarterTurn)for(const instance of spec.instances)instance.transform=[0,-1,0,10,1,0,0,20,0,0,1,30,0,0,0,1];
    const a=probe.tiltYdeg*Math.PI/180;
    const meshes:Record<string,Buffer>={},meshHashes:Record<string,string>={};
    for(const [id,source] of Object.entries(base)) {
      const bytes=Buffer.from(source);
      for(let i=0;i<bytes.readUInt32LE(80);i++)for(let v=0;v<3;v++) {
        const p=84+50*i+12+12*v,x=source.readFloatLE(p),z=source.readFloatLE(p+8);
        bytes.writeFloatLE(x*Math.cos(a)+z*Math.sin(a)+probe.shiftXmm,p);
        bytes.writeFloatLE(-x*Math.sin(a)+z*Math.cos(a),p+8);
      }
      meshes[id]=bytes;meshHashes[id]=sha(bytes);await fs.writeFile(`${directory}/${probe.id}-${id}.stl`,bytes);
    }
    const measurement=measureRevoluteFit({spec,connectionId:"hinge",meshes,boreInstanceId:"moving-instance"});
    const frames=checkMeasuredJointFrames({spec,measurement,limits:protocol.digitalLimits});
    results.push({probe,spec,meshHashes,measurement,frames,expectedStatusMatched:frames.status===probe.expected});
  }
  const changed=[] as string[];
  for(const file of codeFiles)if(sha(await fs.readFile(file))!==hashes[file])changed.push(file);
  await fs.writeFile(`${directory}/report.json`,JSON.stringify({status:"NOT_RUN",scope:protocol.scope,protocolSha256:sha(protocolBytes),codeHashes:hashes,codeUnchangedDuringRun:changed.length===0,changedCodeFiles:changed,protocolAssertionsPassed:results.every(row=>row.expectedStatusMatched),results},null,2));
  console.log(JSON.stringify({directory,protocolSha256:sha(protocolBytes),results:results.map(row=>({id:row.probe.id,status:row.frames.status,measuredPair:row.frames.measuredPair,sides:row.frames.sides.map(side=>({id:side.instanceId,offsetMm:side.offsetMm,angleDeg:side.angleDeg}))}))},null,2));
  if(changed.length||results.some(row=>!row.expectedStatusMatched))process.exitCode=1;
}
if(import.meta.main)main().catch(error=>{console.error(error);process.exitCode=1;});
