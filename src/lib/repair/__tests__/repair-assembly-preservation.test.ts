import {expect,mock,test} from "bun:test";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
if(process.env.AGENTSCAD_ASSEMBLY_REPAIR_CHILD!=="1") {
  test("product repair preserves assembly contracts under isolated model responses",()=>{
    const r=spawnSync(process.execPath,["test",import.meta.path],{encoding:"utf8",timeout:60000,env:{...process.env,AGENTSCAD_ASSEMBLY_REPAIR_CHILD:"1"}});
    expect(r.status,r.stdout+r.stderr).toBe(0);
  },60000);
} else {
  const spec=JSON.parse(fs.readFileSync("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
  const artifact=(value:unknown,size=1)=>`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(value)}\nEND_AGENTSCAD_ASSEMBLY */\nsize=${size};\nmodule generated_part(){cube(size);}\ngenerated_part();`;
  let reply="",calls=0,prompt="";
  mock.module("@/lib/tools/model-router",()=>({createChatCompletionDetailed:mock(async(input:{messages:Array<{content:string}>})=>{
    calls++;prompt=input.messages.map(m=>m.content).join("\n");
    return {content:"```scad\n"+reply+"\n```",model:"test",provider:"test",finishReason:"stop",responseLength:reply.length,rawSnippet:"isolated fixture"};
  })}));
  const run=async()=>{const {runRepair}=await import("../repair-controller");return runRepair({originalRequest:"两件式铰链，直径间隙0.35到0.45mm，能转±45°，可组装可拆",partFamily:"unknown",currentScadCode:artifact(spec),validationResults:[],repairStrategy:"simplify"});};
  test("compile simplification cannot discard a valid assembly",async()=>{
    reply="module generated_part(){cube(1);}\ngenerated_part();";const before=calls;
    await expect(run()).rejects.toThrow("removed or invalidated");expect(calls-before).toBe(1);expect(prompt).toContain("Preserve the existing assembly");
  });
  test("dropping operations or shrinking travel is rejected before returning a candidate",async()=>{
    for(const change of [(s:typeof spec)=>{s.operations=[];},(s:typeof spec)=>{s.connections[0].range={min:-10,max:10,unit:"deg"};}]){
      const candidate=structuredClone(spec);change(candidate);reply=artifact(candidate);
      await expect(run()).rejects.toThrow("Assembly repair rejected");
    }
  });
  test("geometry edits retaining the declaration return editable parameters, without claiming verification",async()=>{
    reply=artifact(spec,2);const result=await run();expect(result.generationResult.scad_source).toContain("size=2");
    expect(result.generationResult.parameters.some(p=>p.key==="size")).toBe(true);
    expect(result.repairMeta.requires_rerender).toBe(true);
  });
}
