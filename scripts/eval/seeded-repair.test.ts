import {test,expect} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {loadSeededRepair} from "./seeded-repair";
import {loadTaskSet} from "./generation-trial";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
test("retained repair inputs are hash-bound and allow exactly one new call",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"agentscad-seeded-repair-"));
 try {
  const tasks=loadTaskSet(JSON.parse(await fs.readFile("scripts/eval/assembly-generation/retained-hinge-repair-v1.json","utf8")));
  const spec=JSON.parse(await fs.readFile("scripts/eval/assembly-fixtures/axial-hinge-operations-v2.spec.json","utf8"));
  const source=`/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\ncube(1);`;
  const feedback=JSON.stringify({sourceSha256:sha(source),passed:false,findings:["Operation insert-moving has excessive pose spacing"]});
  const sourcePath=path.join(dir,"source.scad"),feedbackPath=path.join(dir,"feedback.json"),protocolPath=path.join(dir,"protocol.json");
  await fs.writeFile(sourcePath,source);await fs.writeFile(feedbackPath,feedback);
  const protocol={taskSetSha256:tasks.taskSetSha256,sourcePath,sourceSha256:sha(source),feedbackPath,feedbackSha256:sha(feedback)};
  await fs.writeFile(protocolPath,JSON.stringify(protocol));
  const seed=await loadSeededRepair(protocolPath,tasks);expect(seed.source).toBe(source);expect(seed.feedback).toContain("pose spacing");
  await fs.writeFile(sourcePath,source+"\n");await expect(loadSeededRepair(protocolPath,tasks)).rejects.toThrow("hash changed");
  await fs.writeFile(sourcePath,source);
  const wrongTask={...tasks,taskSetSha256:"0".repeat(64)};await expect(loadSeededRepair(protocolPath,wrongTask)).rejects.toThrow("task set");
  const multipleCalls={...tasks,tasks:tasks.tasks.map(task=>({...task,maxRepairs:1}))};await expect(loadSeededRepair(protocolPath,multipleCalls)).rejects.toThrow("exactly one new call");
  const wrongFeedback=JSON.stringify({sourceSha256:"0".repeat(64),passed:false,findings:["Unbound feedback"]});
  await fs.writeFile(feedbackPath,wrongFeedback);await fs.writeFile(protocolPath,JSON.stringify({...protocol,feedbackSha256:sha(wrongFeedback)}));
  await expect(loadSeededRepair(protocolPath,tasks)).rejects.toThrow("identify this failed retained source");
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
