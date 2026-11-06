import {test,expect} from "bun:test";
import fs from "node:fs/promises";
import {validateAssemblyArtifact} from "../../validation/assembly-validation";
import {prepareContractAssembly} from "../../assembly/prepare-contract-assembly";
import {judgeAssemblyCandidate} from "../../../../scripts/eval/judge-assembly";
test("normal validation measures actual selected hinge meshes and preserves unconfirmed standing",async()=>{
 const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
 const geometry=await fs.readFile("benchmarks/assembly/axial_hinge.scad","utf8");
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${geometry}`;
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆",scadSource:source});
 expect(row.status).toBe("NOT_RUN");expect(row.passed).toBe(false);
 expect(row.assemblyEvidence?.manifest.contract.evidenceCurrent).toBe(false);
 expect(row.assemblyEvidence?.manifest.declaredAssembly.measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.declaredDisassembly.measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.fits[0].measuredStatus).toBe("PASS");
 expect(row.assemblyEvidence?.manifest.evidence.motion.status).toBe("NOT_RUN");
},60000);

test("offline judging does not rotate a grounded second endpoint as if it were movable",async()=>{
 const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
 spec.groundedInstanceId=spec.connections[0].b;
 const geometry=await fs.readFile("benchmarks/assembly/axial_hinge.scad","utf8");
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${geometry}`;
 const result=await judgeAssemblyCandidate({prompt:"两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆",scad:source});
 expect(result.passed).toBe(false);
 expect(result.evidence.find(item=>item.id==="sampled-motion")?.status).toBe("NOT_RUN");
 expect(result.evidence.find(item=>item.id==="motion-range-negative-end")?.status).toBe("NOT_RUN");
 const prepare:typeof prepareContractAssembly=(input)=>prepareContractAssembly({...input,contractGate:{evidenceCurrent:true}});
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆",scadSource:source},prepare);
 expect(row.assemblyEvidence?.manifest.evidence.motion.status).toBe("NOT_RUN");
 expect(row.assemblyEvidence?.requirements.find(item=>item.id==="motion-range-negative-end")?.status).toBe("NOT_RUN");
},60000);

test("real hinge exports and sampled range are compared with the frozen requested count and endpoints",async()=>{
 const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
 const geometry=await fs.readFile("benchmarks/assembly/axial_hinge.scad","utf8");
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${geometry}`;
 // Simulate confirmation only in this isolated test; no user decision or database is written.
 const prepare:typeof prepareContractAssembly=(input)=>prepareContractAssembly({...input,contractGate:{evidenceCurrent:true}});
 const goodRequest="两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆";
 const [good]=await validateAssemblyArtifact({inputRequest:goodRequest,scadSource:source},prepare);
 const assertions=Object.fromEntries(good.assemblyEvidence!.requirements.map(item=>[item.id,item]));
 for(const id of ["distinct-exported-parts","motion-range-negative-end","motion-range-positive-end","diametral-clearance"])
  expect(assertions[id].status).toBe("PASS");
 // The independently unresolved retention question still blocks the aggregate.
 expect(good.status).toBe("NOT_RUN");expect(good.message).toContain("axial-retention NOT_RUN");
 const [wrong]=await validateAssemblyArtifact({inputRequest:"三件式铰链，直径间隙0.35到0.45mm，能转±60°，可组装可拆",scadSource:source},prepare);
 const missing=Object.fromEntries(wrong.assemblyEvidence!.requirements.map(item=>[item.id,item]));
 expect(wrong.status).toBe("FAIL");expect(missing["distinct-exported-parts"].status).toBe("FAIL");
 expect(missing["motion-range-negative-end"].status).toBe("FAIL");expect(missing["motion-range-positive-end"].status).toBe("FAIL");
},60000);
