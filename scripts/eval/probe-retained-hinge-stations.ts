#!/usr/bin/env bun
/** Diagnostic station choices, never automatic selection or a new model score. */
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {extractEmbeddedAssemblySpec} from "../../src/lib/assembly/embedded-spec";
import {measureRevoluteFit} from "../../src/lib/assembly/fit-measurement";
import {checkDeclaredPoseAssembly} from "../../src/lib/assembly/declared-pose-assembly";
import {checkDeclaredPoseDisassembly} from "../../src/lib/assembly/declared-pose-disassembly";
import {ASSEMBLY_VERIFIER_SOURCES} from "../../src/lib/assembly/verification-types";
const input=process.argv[2];if(!input)throw new Error("Supply retained candidate prefix without .scad");
const source=await fs.readFile(input+".scad","utf8"),extracted=extractEmbeddedAssemblySpec(source);
if(extracted.status!=="valid")throw new Error("Invalid retained declaration");
const spec=extracted.spec,joint=spec.connections.find(c=>c.type==="revolute");
if(!joint?.boreInstanceId)throw new Error("Explicit bore role required");
const archive=await fs.mkdtemp(path.resolve(".agentscad/experiments/retained-station-probe-"));
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const files=[...new Set([...ASSEMBLY_VERIFIER_SOURCES,"src/lib/geometry/cylindrical-feature.ts","src/lib/geometry/stl-mesh.ts","scripts/eval/probe-retained-hinge-stations.ts"])];
const tools:Array<{file:string;sha256:string}>=[];
for(const file of files){const bytes=await fs.readFile(file),dest=path.join(archive,"tools",file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);tools.push({file,sha256:sha(bytes)});}
await fs.writeFile(path.join(archive,"source.scad"),source);
const meshes:Record<string,Buffer>={};
for(const part of spec.parts){if(part.source!=="generated")throw new Error("This diagnostic requires all retained meshes");meshes[part.id]=await fs.readFile(`${input}-${part.id}.stl`);await fs.writeFile(path.join(archive,`${part.id}.stl`),meshes[part.id]);}
const protocol={scope:"Exposed diagnostic only. Local stations manually chosen from retained source barrel extent [-6,6] before measurement. No adaptive search for passing stations, no general feature locator, no changed geometry or model calls.",cases:[{id:"existing-default",stationsMm:null},{id:"local-barrel-including-middle",stationsMm:[-5.5,0,5.5]}],sourceSha256:sha(source),partHashes:Object.fromEntries(Object.entries(meshes).map(([id,b])=>[id,sha(b)]))};
await fs.writeFile(path.join(archive,"protocol.json"),JSON.stringify(protocol,null,2));
const results=protocol.cases.map(c=>({id:c.id,measurement:measureRevoluteFit({spec,connectionId:joint.id,boreInstanceId:joint.boreInstanceId!,meshes,...(c.stationsMm?{stationsMm:c.stationsMm}:{})})}));
const paths={assembly:checkDeclaredPoseAssembly({spec,meshes}),disassembly:checkDeclaredPoseDisassembly({spec,meshes})};
const codeUnchangedDuringRun=(await Promise.all(tools.map(async t=>sha(await fs.readFile(t.file))===t.sha256))).every(Boolean);
const report={protocol,tools,codeUnchangedDuringRun,results,paths,physical:"NOT_RUN",modelCalls:0};
await fs.writeFile(path.join(archive,"report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({archive,codeUnchangedDuringRun,results:results.map(r=>({id:r.id,status:r.measurement.status,reason:r.measurement.reason,stations:r.measurement.stationsMm,bore:r.measurement.bore?.measurement.status,shaft:r.measurement.shaft?.measurement.status})),paths:{assembly:paths.assembly.reason,disassembly:paths.disassembly.reason}},null,2));
