import {test,expect} from "bun:test";
import {validateAssemblyArtifact,unverifiedAssemblyRequirements} from "./assembly-validation";
import {deriveRequirementContract} from "../requirements/extract-requirements";
test("single part validation adds no assembly work",async()=>{
 expect(await validateAssemblyArtifact({inputRequest:"cube",scadSource:"cube(1);"})).toEqual([]);
});
test("an explicit assembly requirement without declaration blocks repair and delivery",async()=>{
 const [row]=await validateAssemblyArtifact({inputRequest:"两件式铰链，可组装可拆",scadSource:"cube(1);"});
 expect(row.status).toBe("FAIL");expect(row.is_critical).toBe(true);expect(row.passed).toBe(false);
});
test("a malformed declaration preserves its actual parse failure",async()=>{
 const [row]=await validateAssemblyArtifact({inputRequest:"铰链",scadSource:"/* AGENTSCAD_ASSEMBLY_V1\n{}\nEND_AGENTSCAD_ASSEMBLY */\ncube(1);"});
 expect(row.status).toBe("FAIL");expect(row.message).toContain("specification");
});

test("unresolved retention blocks an aggregate pass but cannot hide a measured failure",async()=>{
 const id=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const spec={schemaVersion:1,units:"mm",coordinateSystem:"right-handed",parts:[{id:"part",name:"Part",selector:"part",source:"generated",material:null}],instances:[{id:"one",partId:"part",subassemblyId:null,transform:id}],subassemblies:[],connections:[],groundedInstanceId:"one",motions:[],operations:[],manufacturing:null,assumptions:[],unknowns:[]};
 const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\ncube(1);`;
 const ok={status:"PASS",reason:"measured"};
 const evidence={identity:ok,reconstruction:ok,assembly:ok,assemblyPath:ok,disassembly:ok,motion:ok};
 const prepare=(e:typeof evidence)=>async()=>({manifest:{evidence:e,partConnectivity:[{partId:"part",status:"PASS"}],fits:[]},parts:[{},{}],fits:[],kinematics:null}) as never;
 const input={inputRequest:"两件式铰链，间隙0.35到0.45mm，能转±45°，可组装可拆卸，3D打印",scadSource:source};
 const [pending]=await validateAssemblyArtifact(input,prepare(evidence));
 expect(pending.status).toBe("NOT_RUN");expect(pending.message).toContain("axial-retention NOT_RUN");
 expect(pending.message).toContain("Digital evidence only");
 const [failed]=await validateAssemblyArtifact(input,prepare({...evidence,motion:{status:"FAIL",reason:"collision"}}));
 expect(failed.status).toBe("FAIL");expect(failed.message).toContain("axial-retention NOT_RUN");
 const explicit={...input,inputRequest:input.inputRequest+"。工作姿态必须有几何轴向防脱。"};
 const [unmeasured]=await validateAssemblyArtifact(explicit,prepare(evidence));
 expect(unmeasured.status).toBe("NOT_RUN");
 expect(unmeasured.message).toContain("requirement axial-retention NOT_RUN:");
 expect(unmeasured.message).not.toContain("No automatic assertion is implemented");
 expect(unmeasured.message).not.toContain("轴向保持方式未说明");
});

test("an explicitly confirmed retention assertion is routed to its measured-probe assertion",()=>{
 const contract=deriveRequirementContract({request:"两件式铰链可组装可拆卸"});
 const requirement={id:"axial-retention",layer:"assembly" as const,required:true,applicable:true,
   expected:{kind:"equals" as const,value:true},provenance:"confirmed" as const,statement:null};
 expect(unverifiedAssemblyRequirements({...contract,requirements:[...contract.requirements,requirement]}).map(item=>item.id)).not.toContain("axial-retention");
 expect(unverifiedAssemblyRequirements({...contract,requirements:[...contract.requirements,{...requirement,required:false}]}).map(item=>item.id)).not.toContain("axial-retention");
});

test("count, range and fit are routed to explicit assertions rather than silently omitted",()=>{
 const contract=deriveRequirementContract({request:"两件式铰链，间隙0.35到0.45mm，能转±45°，可拆卸"});
 const ids=unverifiedAssemblyRequirements(contract).map(item=>item.id);
 expect(ids).not.toContain("distinct-exported-parts");
 expect(ids).not.toContain("motion-range-negative-end");
 expect(ids).not.toContain("motion-range-positive-end");
 expect(ids).not.toContain("diametral-clearance");
 expect(ids).not.toContain("intent-preserved");
});

test("a confirmed path requirement with different semantics is not treated as the standard clear path",()=>{
 const contract=deriveRequirementContract({request:"两件式铰链，可拆卸"});
 const changed={...contract,requirements:contract.requirements.map(item=>item.id==="disassembly-path"
  ? {...item,expected:{kind:"equals" as const,value:false}} : item)};
 expect(unverifiedAssemblyRequirements(changed).map(item=>item.id)).toContain("disassembly-path");
});
