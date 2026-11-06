import {test,expect} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {loadTaskSet} from "./generation-trial";
const runner="scripts/eval/paid-assembly-trial.ts";
const tasks="scripts/eval/assembly-generation/operations-tasks-v1.json";
async function dryRun(args:string[]) {
  const proc=Bun.spawn([process.execPath,runner,...args],{stdout:"pipe",stderr:"pipe",
    env:{...process.env,AGENTSCAD_ALLOW_PAID:"",AGENTSCAD_PAID_KEY_FILE:""}});
  const [stdout,stderr,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  return {stdout,stderr,code};
}
test("explicit frozen operation trial plans two calls without credentials or changing the authorization",async()=>{
  const ledger=".agentscad/experiments/deepseek-28cny-authorization-2026-11-05.json";
  const before=await fs.readFile(ledger).catch(()=>null);
  const frozen=loadTaskSet(JSON.parse(await fs.readFile(tasks,"utf8")));
  const result=await dryRun(["--tasks",tasks,"--non-thinking"]);
  expect(result.code).toBe(0);
  const plan=JSON.parse(result.stdout);
  expect(plan.taskSetSha256).toBe(frozen.taskSetSha256);
  expect(plan.maxCalls).toBe(2);
  expect(plan.worstCaseCny).toBe(1.448576);
  expect(plan.reasoningEffort).toBe("none");
  expect(await fs.readFile(ledger).catch(()=>null)).toEqual(before);
});
test("missing explicit task path fails before model admission",async()=>{
  const result=await dryRun(["--tasks","--non-thinking"]);
  expect(result.code).toBe(1);expect(result.stderr).toContain("--tasks requires");
});
test("legacy frozen task set remains the default",async()=>{
  const result=await dryRun([]);expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).taskPath).toBe("scripts/eval/assembly-generation/tasks.json");
});

test("continued dry run includes prior charges and rejects an exhausted authorization",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"agentscad-paid-plan-"));
  try {
    await fs.mkdir(path.join(dir,".agentscad/experiments"),{recursive:true});
    const ledger=path.join(dir,".agentscad/experiments/deepseek-28cny-authorization-2026-11-05.json");
    for(const cost of [1.649062,27]) {
      await fs.writeFile(ledger,JSON.stringify({status:"TERMINAL",maxCny:28,model:"deepseek-v4-flash",calls:[{accountedCny:cost}]}));
      const proc=Bun.spawn([process.execPath,path.resolve(runner),"--tasks",path.resolve(tasks),"--continue-authorized"],{cwd:dir,stdout:"pipe",stderr:"pipe"});
      const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
      if(cost===27){expect(code).toBe(1);expect(err).toContain("Remaining authorization");}
      else {expect(code).toBe(0);expect(JSON.parse(out).totalAuthorizationWorstCaseCny).toBeCloseTo(3.097638,6);}
    }
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
