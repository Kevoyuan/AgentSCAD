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

test("real hinge exports are compared with the frozen requested count while the range stays unmeasured without a source binding",async()=>{
 const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
 const geometry=await fs.readFile("benchmarks/assembly/axial_hinge.scad","utf8");
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\n${geometry}`;
 // Simulate confirmation only in this isolated test; no user decision or database is written.
 const prepare:typeof prepareContractAssembly=(input)=>prepareContractAssembly({...input,contractGate:{evidenceCurrent:true}});
 const goodRequest="两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆";
 const [good]=await validateAssemblyArtifact({inputRequest:goodRequest,scadSource:source},prepare);
 const assertions=Object.fromEntries(good.assemblyEvidence!.requirements.map(item=>[item.id,item]));
 for(const id of ["distinct-exported-parts","diametral-clearance"])
  expect(assertions[id].status).toBe("PASS");
 // The axial hinge source has no source-driven parameter/pose binding, so the
 // source half of motion evidence is unavailable and the range cannot be asserted.
 // The static sampled endpoints are not a substitute for that missing evidence.
 for(const id of ["motion-range-negative-end","motion-range-positive-end"])
  expect(assertions[id].status).toBe("NOT_RUN");
 expect(assertions["motion-range-negative-end"].reason).toContain("source");
 // The independently unresolved retention question still blocks the aggregate.
 expect(good.status).toBe("NOT_RUN");expect(good.message).toContain("axial-retention NOT_RUN");
 const [wrong]=await validateAssemblyArtifact({inputRequest:"三件式铰链，直径间隙0.35到0.45mm，能转±60°，可组装可拆",scadSource:source},prepare);
 const missing=Object.fromEntries(wrong.assemblyEvidence!.requirements.map(item=>[item.id,item]));
 expect(wrong.status).toBe("FAIL");expect(missing["distinct-exported-parts"].status).toBe("FAIL");
 for(const id of ["motion-range-negative-end","motion-range-positive-end"])
  expect(missing[id].status).toBe("NOT_RUN");
},60000);

test("a complete explicit contract with declared axial probes reaches A001 PASS",async()=>{
 const geometry=await fs.readFile("scripts/eval/assembly-fixtures/candidates/thick-hinge-control-2026-11-11.scad","utf8");
 const request="做一个两件式铰链，直径间隙0.35到0.45毫米，能转±45度，可组装可拆卸，工作姿态必须有轴向防脱，独立释放后才能拆下";
 // Simulate confirmation only in this isolated test; no user decision or database is written.
 // The frozen seed makes the seeded challenge pose reproducible; the product path generates a fresh seed per run.
 const prepare:typeof prepareContractAssembly=(input)=>prepareContractAssembly({...input,contractGate:{evidenceCurrent:true},sourceSamplingSeed:"11223344556677889900aabbccddeeff"});
 const previous=process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS;
 process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS="60000";
 try{
  const [row]=await validateAssemblyArtifact({inputRequest:request,scadSource:geometry},prepare);
  expect(row.status).toBe("PASS");
  expect(row.passed).toBe(true);
  const requirements=Object.fromEntries(row.assemblyEvidence!.requirements.map(item=>[item.id,item]));
  for(const id of ["distinct-exported-parts","motion-range-negative-end","motion-range-positive-end","diametral-clearance","axial-retention"])
   expect(requirements[id].status).toBe("PASS");
  expect(requirements["axial-retention"].reason).toContain("declared-geometry evidence");
  expect(row.message).not.toContain("axial-retention NOT_RUN");
 }finally{
  if(previous===undefined)delete process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS;
  else process.env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS=previous;
 }
},240000);

test("offline trial measures source motion and axial retention under a derived-contract attribution gate",async()=>{
 const geometry=await fs.readFile("scripts/eval/assembly-fixtures/candidates/thick-hinge-control-2026-11-11.scad","utf8");
 const prompt="做一个两件式铰链，直径间隙0.35到0.45毫米，能转±45度，可组装可拆卸，工作姿态必须有轴向防脱，独立释放后才能拆下";
 const result=await judgeAssemblyCandidate({prompt,scad:geometry,sourceSamplingSeed:"11223344556677889900aabbccddeeff"});
 // The intent layer has no independent coverage audit, so a trial can only
 // report per-assertion evidence, never a user-acceptance pass.
 expect(result.passed).toBe(false);
 const evidence=Object.fromEntries(result.evidence.map(item=>[item.id,item.status]));
 for(const id of ["sampled-motion","rigid-motion","source-motion","axial-retention","assembly-path","disassembly-path","diametral-clearance"])
  expect(evidence[id], JSON.stringify({id,evidence,findings:result.findings},null,2)).toBe("PASS");
 expect(evidence["intent-preserved"]).toBe("NOT_RUN");
 expect(result.trialAttribution).toContain("not user confirmation");
 expect(result.findings.join("\n")).toContain("Measurement attribution");
},300000);
