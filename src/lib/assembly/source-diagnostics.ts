import {createHash} from "node:crypto";
import {canonicalJson} from "../canonical-json";
import {extractEmbeddedAssemblyDiagnosticLayout} from "./embedded-spec";
import {renderAssemblyParts,type RenderedAssemblyPart} from "../tools/assembly-part-renderer";
import {checkPartConnectivity} from "./part-connectivity";
import {checkPartIdentity} from "./part-identity-check";
import {readBinaryStl} from "../geometry/stl-mesh";
import {buildBvh,placeBvh,bvhIntersects,type CollisionResult} from "../geometry/mesh-collision";

export interface AssemblySourceDiagnostics {
  sourceSha256:string;
  layoutSha256:string|null;
  execution:"COMPLETED"|"NOT_RUN"|"ERROR";
  reason:string;
  scope:string;
  limits:{renderMs:number;geometryMs:number;trianglesPerPart:number;pairTests:number};
  parts:Array<{partId:string;sha256:string;measurement:ReturnType<typeof checkPartConnectivity>}>;
  selectorDistinctness:ReturnType<typeof checkPartIdentity>["distinctness"]|null;
  collisions:Array<{instanceIds:[string,string];measurement:CollisionResult}>;
  unavailableInstanceIds:string[];
}
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");

/** Diagnostic measurements only; a valid subset cannot replace the failed contract.
 * No files are published. Callers may retain returned buffers separately. */
export async function diagnoseAssemblySource(input:{scadSource:string;signal?:AbortSignal},render=renderAssemblyParts) {
  const report:AssemblySourceDiagnostics={sourceSha256:sha(input.scadSource),layoutSha256:null,execution:"NOT_RUN",reason:"",
    scope:"Raw diagnostics from independently validated part selectors and declared rigid instance poses only. No complete assembly contract, intended identity, reconstruction, fit, allowed-contact region, path, motion or physical qualification. INTERSECT may be touching rather than penetration; investigate without assuming all contact must be removed.",
    limits:{renderMs:30000,geometryMs:5000,trianglesPerPart:50000,pairTests:100000},parts:[],selectorDistinctness:null,collisions:[],unavailableInstanceIds:[]};
  let parts:RenderedAssemblyPart[]=[];
  input.signal?.throwIfAborted();
  const extracted=extractEmbeddedAssemblyDiagnosticLayout(input.scadSource);
  if(extracted.status!=="valid-subset") {report.reason=extracted.reason;return {report,parts};}
  const layout=extracted.layout;
  report.layoutSha256=sha(canonicalJson(layout));
  const generated=layout.parts.filter(p=>p.source==="generated");
  report.unavailableInstanceIds=layout.instances.filter(i=>!generated.some(p=>p.id===i.partId)).map(i=>i.id);
  if(!generated.length){report.reason="No generated part meshes; purchased instances were not approximated.";return {report,parts};}
  const deadline=AbortSignal.timeout(report.limits.renderMs);
  try {
    parts=await render({scadSource:input.scadSource,parts:generated.map(p=>({partId:p.id,selector:p.selector})),parameters:{agentscad_pose:false},
      options:{signal:input.signal?AbortSignal.any([input.signal,deadline]):deadline}});
    input.signal?.throwIfAborted();
    if(deadline.aborted){report.reason="Diagnostic render deadline exceeded.";return {report,parts};}
    if(parts.length!==generated.length||new Set(parts.map(p=>p.partId)).size!==generated.length||parts.some(p=>!generated.some(g=>g.id===p.partId)||sha(p.stl)!==p.sha256))throw new Error("Diagnostic rendered inventory/hash mismatch");
    const started=performance.now();
    const meshes=new Map<string,ReturnType<typeof buildBvh>>();
    for(const part of parts) {
      input.signal?.throwIfAborted();
      if(performance.now()-started>report.limits.geometryMs){report.reason="Diagnostic geometry deadline exceeded; partial measurements retained.";return {report,parts};}
      // Parse the actual buffer; never trust a supplied triangleCount to admit a huge mesh.
      if(part.stl.length<84||part.stl.readUInt32LE(80)>report.limits.trianglesPerPart){report.reason="Diagnostic triangle budget exceeded; no complete mesh check.";return {report,parts};}
      const measurement=checkPartConnectivity(part.stl);
      report.parts.push({partId:part.partId,sha256:part.sha256,measurement});
      meshes.set(part.partId,buildBvh(readBinaryStl(part.stl)));
    }
    report.selectorDistinctness=checkPartIdentity({parts:parts.map(p=>({...p,selector:generated.find(g=>g.id===p.partId)!.selector}))}).distinctness;
    for(let a=0;a<layout.instances.length;a++)for(let b=a+1;b<layout.instances.length;b++) {
      input.signal?.throwIfAborted();
      const first=layout.instances[a],second=layout.instances[b];
      const am=meshes.get(first.partId),bm=meshes.get(second.partId);
      if(!am||!bm)continue;
      if(performance.now()-started>report.limits.geometryMs){report.reason="Diagnostic geometry deadline exceeded; partial measurements retained.";return {report,parts};}
      const measurement=bvhIntersects(placeBvh(am,first.transform),placeBvh(bm,second.transform),{maxPairTests:report.limits.pairTests});
      report.collisions.push({instanceIds:[first.id,second.id],measurement});
    }
    if(performance.now()-started>report.limits.geometryMs){report.reason="Diagnostic geometry deadline exceeded; partial measurements retained.";return {report,parts};}
    report.execution="COMPLETED";
    report.reason=report.unavailableInstanceIds.length?"Available generated meshes checked; purchased instance pairs remain unavailable.":"Bounded raw measurements completed; the assembly declaration still requires validation.";
  }catch(error){
    input.signal?.throwIfAborted();
    report.execution=deadline.aborted?"NOT_RUN":"ERROR";
    report.reason=deadline.aborted?"Diagnostic render deadline exceeded.":String(error).slice(0,2000);
  }
  return {report,parts};
}

export function summarizeAssemblySourceDiagnostics(report:AssemblySourceDiagnostics) {
  const lines=[`Partial assembly diagnostics ${report.execution}: ${report.reason}`,report.scope];
  for(const part of report.parts){
    const slab=part.measurement.separator;
    lines.push(`Part ${part.partId} limited connectivity ${part.measurement.status}: ${part.measurement.reason}${slab?` Part-local ${["X","Y","Z"][slab.axis]} empty slab ${slab.lower.toFixed(6)} to ${slab.upper.toFixed(6)} mm, width ${(slab.upper-slab.lower).toFixed(6)} mm. This separates pieces inside this selected part, not a measured clearance between two mating parts.`:""}`);
  }
  if(report.selectorDistinctness)lines.push(`Selector distinctness ${report.selectorDistinctness.status}: ${report.selectorDistinctness.reason}`);
  for(const pair of report.collisions)lines.push(`Declared-pose pair ${pair.instanceIds.join(" / ")}: ${pair.measurement.status}. ${pair.measurement.reason}${pair.measurement.point?` World point [${pair.measurement.point.map(n=>n.toFixed(6)).join(", ")}] mm.`:""}`);
  if(report.unavailableInstanceIds.length)lines.push(`Unavailable obstacle instances: ${report.unavailableInstanceIds.join(", ")}. Their absence is not clearance evidence.`);
  return lines.join("\n").slice(0,8000);
}
