import {test,expect} from "bun:test";
import {createHash} from "node:crypto";
import fixture from "../../../scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json";
import {diagnoseAssemblySource,summarizeAssemblySourceDiagnostics} from "./source-diagnostics";
import {extractEmbeddedAssemblyDiagnosticLayout,extractEmbeddedAssemblySpec} from "./embedded-spec";
import {boxStl,mergeStl} from "../geometry/__tests__/solids";
import {validateAssemblyArtifact} from "../validation/assembly-validation";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const source=(spec:unknown)=>`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\ncube(1);`;
const invalid=()=>({...structuredClone(fixture),operations:[{id:"bad",action:"disassemble",instanceId:"moving-instance",waypoints:[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,12,1]],tools:[]}]});
const part=(partId:string,stl:Buffer)=>({partId,stl,sha256:sha(stl),triangleCount:stl.readUInt32LE(80),diagnostics:""});
const meshes=[part("fixed",boxStl([0,0,0],[2,2,2])),part("moving",boxStl([1,1,1],[3,3,3]))];

test("invalid operations permit only a validated rendering subset, never a valid assembly",()=>{
 const text=source(invalid());
 expect(extractEmbeddedAssemblySpec(text).status).toBe("invalid");
 const partial=extractEmbeddedAssemblyDiagnosticLayout(text);
 expect(partial.status).toBe("valid-subset");
 if(partial.status==="valid-subset")expect(Object.hasOwn(partial.layout,"operations")).toBe(false);
 for(const mutate of [
  (v:ReturnType<typeof invalid>)=>{v.parts[0].selector="../../escape";},
  (v:ReturnType<typeof invalid>)=>{v.instances[0].transform[0]=2;},
  (v:ReturnType<typeof invalid>)=>{v.instances[0].partId="missing";},
  (v:ReturnType<typeof invalid>)=>{v.parts[1].id=v.parts[0].id;},
 ]) {const v=invalid();mutate(v);expect(extractEmbeddedAssemblyDiagnosticLayout(source(v)).status).toBe("unavailable");}
 expect(extractEmbeddedAssemblyDiagnosticLayout(text+text).status).toBe("unavailable");
 expect(extractEmbeddedAssemblyDiagnosticLayout(`echo(${JSON.stringify(text)});`).status).toBe("unavailable");
});

test("raw geometry defects reach A001 repair feedback while the schema stays FAIL",async()=>{
 const diagnostic=await diagnoseAssemblySource({scadSource:source(invalid())},async(input)=>{expect(input.parameters?.agentscad_pose).toBe(false);return meshes;});
 expect(diagnostic.report.execution).toBe("COMPLETED");
 expect(diagnostic.report.collisions[0].measurement.blocked).toBe(true);
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链",scadSource:source(invalid())},undefined,async()=>diagnostic);
 expect(row.status).toBe("FAIL");expect(row.passed).toBe(false);
 expect(row.assemblyEvidence).toBeUndefined();
 expect(row.assemblyDiagnostics?.sourceSha256).toBe(diagnostic.report.sourceSha256);
 expect(row.message).toContain("operations.0.waypoints.0");
 expect(row.message).toContain("fixed-instance / moving-instance");
 expect(row.message).toContain("INTERSECT");
 expect(row.message).toContain("may be touching rather than penetration");
});

test("unavailable purchased bodies cannot become clearance evidence",async()=>{
 const spec=invalid();spec.parts[0].source="purchased";
 const {report}=await diagnoseAssemblySource({scadSource:source(spec)},async()=>[meshes[1]]);
 expect(report.unavailableInstanceIds).toEqual(["fixed-instance"]);
 expect(report.collisions).toHaveLength(0);
 expect(summarizeAssemblySourceDiagnostics(report)).toContain("absence is not clearance evidence");
});

test("a repair that opens a gap within one part reports the actual separating interval",async()=>{
 const separated=part("moving",mergeStl(boxStl([0,0,0],[1,1,1]),boxStl([1.4,0,0],[2.4,1,1])));
 const {report}=await diagnoseAssemblySource({scadSource:source(invalid())},async()=>[meshes[0],separated]);
 expect(report.parts.find(p=>p.partId==="moving")?.measurement.status).toBe("FAIL");
 const feedback=summarizeAssemblySourceDiagnostics(report);
 expect(feedback).toContain("Part-local X empty slab 1.000000 to 1.400000 mm, width 0.400000 mm");
 expect(feedback).toContain("not a measured clearance between two mating parts");
});

test("bad metadata, inventory/hash failures and triangle budgets do not get geometry success",async()=>{
 let calls=0;
 const noLayout=await diagnoseAssemblySource({scadSource:source({})},async()=>{calls++;return meshes;});
 expect(noLayout.report.execution).toBe("NOT_RUN");expect(calls).toBe(0);
 const badHash=await diagnoseAssemblySource({scadSource:source(invalid())},async()=>[{...meshes[0],sha256:"0".repeat(64)},meshes[1]]);
 expect(badHash.report.execution).toBe("ERROR");expect(badHash.report.collisions).toHaveLength(0);
 const oversized=Buffer.from(meshes[0].stl);oversized.writeUInt32LE(50001,80);
 const over=await diagnoseAssemblySource({scadSource:source(invalid())},async()=>[part("fixed",oversized),meshes[1]]);
 expect(over.report.execution).toBe("NOT_RUN");expect(over.report.reason).toContain("triangle budget");
 const controller=new AbortController();controller.abort();
 await expect(diagnoseAssemblySource({scadSource:source(invalid()),signal:controller.signal},async()=>meshes)).rejects.toThrow();
});
