import {expect,mock,test} from "bun:test";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
if(process.env.AGENTSCAD_VISUAL_ASSEMBLY_CHILD!=="1") {
  test("visual analysis and repair preserve assembly under isolated model responses",()=>{
    const result=spawnSync(process.execPath,["test",import.meta.path],{encoding:"utf8",timeout:60000,env:{...process.env,AGENTSCAD_VISUAL_ASSEMBLY_CHILD:"1"}});
    expect(result.status,result.stdout+result.stderr).toBe(0);
  },60000);
} else {
  const spec=JSON.parse(fs.readFileSync("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
  const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\nmodule generated_part(){cube(1);}\ngenerated_part();`;
  let responses:string[]=[];
  const requests:unknown[]=[];
  mock.module("@/lib/tools/model-router",()=>({createChatCompletionWithFallback:mock(async(input:unknown)=>{
    requests.push(input);
    const response=responses.shift();
    if(response===undefined)throw new Error("Unexpected model call");
    return response;
  })}));
  test("a visual proposal deleting the assembly is rejected after exactly two calls",async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"agentscad-visual-guard-"));
    const image=path.join(dir,"preview.png");
    fs.writeFileSync(image,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=","base64"));
    try {
      const {runVisualRepair}=await import("../visual-repair-controller");
      const input={originalRequest:"两件式铰链，可组装可拆，能转±45°",confirmedRequirementsContext:"Confirmed retention: 10 N",partFamily:null,scadSource:source,previewImagePath:image};
      responses=[JSON.stringify({confidence:0.8,visual_issues:[{requirement:"leaf",observed:"missing leaf",severity:"high",repair_hint:"restore leaf"}]}),"```scad\nmodule generated_part(){cube(2);}\ngenerated_part();\n```"];
      await expect(runVisualRepair(input)).rejects.toThrow("Assembly repair rejected");
      expect(requests.length).toBe(2);
      expect(JSON.stringify(requests[1])).toContain("Confirmed retention: 10 N");
      expect(input.scadSource).toBe(source);
      responses=[JSON.stringify({confidence:0.8,visual_issues:[]})];
      const result=await runVisualRepair(input);
      expect(result.repairedScad).toBe(source);
      expect(requests.length).toBe(3);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}
