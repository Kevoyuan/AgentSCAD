#!/usr/bin/env bun
/** Re-evaluate retained model artifacts without any model calls or spending. */
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {loadTaskSet} from "./generation-trial";
import {judgeAssemblyCandidate} from "./judge-assembly";
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");

async function main() {
  const input=process.argv[2];
  if(!input)throw new Error("Supply a completed paid trial directory");
  const bytes=await fs.readFile(path.join(input,"report.json"));
  const original=JSON.parse(bytes.toString()) as {allJudgements:Array<{taskId:string;attempt:number;evidence:Array<{id:string;status:string}>}>};
  const taskBytes=await fs.readFile(path.join(input,"tasks.json"));
  const tasks=loadTaskSet(JSON.parse(taskBytes.toString()));
  const directory=await fs.mkdtemp(path.join(".agentscad/experiments","rejudged-assembly-"));
  // Freeze sources before evaluation, not afterwards: concurrent work must not
  // attach a later file version to a result produced by an earlier module.
  const codeFiles=["scripts/eval/rejudge-assembly-trial.ts","scripts/eval/judge-assembly.ts","src/lib/requirements/extract-requirements.ts","src/lib/tools/assembly-reconstruction.ts","src/lib/assembly/prepare-assembly.ts","src/lib/assembly/part-identity-check.ts","src/lib/assembly/fit-measurement.ts","src/lib/assembly/measured-joint-frame.ts","src/lib/assembly/path-and-motion.ts","src/lib/geometry/cylindrical-feature.ts"];
  const codeHashes:Record<string,string>={};
  for(const file of codeFiles) {
    const code=await fs.readFile(file);codeHashes[file]=sha(code);await fs.writeFile(path.join(directory,path.basename(file)),code);
  }
  const results:Array<Record<string,unknown>>=[];
  for(const candidate of original.allJudgements) {
    const task=tasks.tasks.find(t=>t.id===candidate.taskId);
    if(!task||!Number.isInteger(candidate.attempt)||candidate.attempt<0)throw new Error("Invalid retained candidate identity");
    if(candidate.evidence.some(e=>e.id==="repair-preservation"&&e.status==="FAIL")) {
      results.push({taskId:task.id,attempt:candidate.attempt,status:"SKIP",reason:"Previously rejected declaration rewrite; not admitted as a repair"});continue;
    }
    const name=`${task.id}-${candidate.attempt}`;
    const source=await fs.readFile(path.join(input,`${name}.scad`),"utf8");
    await fs.writeFile(path.join(directory,`${name}.scad`),source);
    try {
      const judgment=await judgeAssemblyCandidate({prompt:task.prompt,scad:source,onPrepared:async(prepared,whole)=>{
        await fs.writeFile(path.join(directory,`${name}-manifest.json`),JSON.stringify(prepared.manifest,null,2));
        await fs.writeFile(path.join(directory,`${name}-assembly.stl`),whole.stl);
        await Promise.all(prepared.parts.map(part=>fs.writeFile(path.join(directory,`${name}-${part.partId}.stl`),part.stl)));
      }});
      results.push({taskId:task.id,attempt:candidate.attempt,sourceSha256:sha(source),judgment});
    } catch(error) {
      results.push({taskId:task.id,attempt:candidate.attempt,sourceSha256:sha(source),status:"ERROR",reason:String(error)});
    }
  }
  const changedCodeFiles:string[]=[];
  for(const file of codeFiles)if(sha(await fs.readFile(file))!==codeHashes[file])changedCodeFiles.push(file);
  const report={status:changedCodeFiles.length?"ERROR":"NOT_RUN",scope:"Zero-model-cost rejudging of retained model artifacts under the current evaluator. No regeneration, user acceptance or physical function.",inputDirectory:input,inputReportSha256:sha(bytes),taskSetSha256:tasks.taskSetSha256,codeHashes,codeUnchangedDuringRun:changedCodeFiles.length===0,changedCodeFiles,results};
  await fs.writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(directory,"tasks.json"),taskBytes);
  console.log(JSON.stringify({directory,results:results.map(({taskId,attempt,status,judgment})=>({taskId,attempt,status,judgment}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
