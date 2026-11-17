#!/usr/bin/env bun
/** Explicitly authorized CNY-bounded trial using the product's model router. */
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {createChatCompletionDetailed} from "../../src/lib/tools/model-router";
import type {ProviderConfig} from "../../src/lib/provider-settings";
import {withLlmCallMeter,llmCallsThisRun,ModelRequestError} from "../../src/lib/model-runtime";
import {loadSkill,skillInstructions} from "../../src/lib/skill-resolver";
import {extractOpenScadCodeFromText} from "../../src/lib/harness/structured-output";
import {sanitizeGeneratedScadSource} from "../../src/lib/tools/scad-sanitizer";
import {extractEmbeddedAssemblySpec} from "../../src/lib/assembly/embedded-spec";
import {assertRepairPreservesAssembly, ASSEMBLY_REPAIR_INVARIANTS} from "../../src/lib/assembly/repair-findings";
import {deriveRequirementContract} from "../../src/lib/requirements/extract-requirements";
import {focusRepairFeedback,loadTaskSet,planTrial,runTrial,TrialRefused,worstCaseCalls} from "./generation-trial";
import {judgeAssemblyCandidate} from "./judge-assembly";

import {ASSEMBLY_VERIFIER_SOURCES} from "../../src/lib/assembly/verification-types";

import {loadSeededRepair} from "./seeded-repair";

const MODEL="deepseek-v4-flash";
const argument=(name:string,fallback:string)=>{
  const index=process.argv.indexOf(name);
  if(index<0)return fallback;
  const value=process.argv[index+1];
  if(!value||value.startsWith("--"))throw new Error(`${name} requires a value`);
  return value;
};
const MAX_CNY=Number(argument("--max-cny","28"));
if(!Number.isFinite(MAX_CNY)||MAX_CNY<=0)throw new Error("--max-cny must be a positive number");
const AUTHORIZATION_PATH=argument("--authorization",".agentscad/experiments/deepseek-28cny-authorization-2026-11-05.json");
const MAX_INPUT_BOUND=Number(argument("--max-input-bound","100000"));
const MAX_OUTPUT=Number(argument("--max-output-tokens","65536"));
if(!Number.isInteger(MAX_INPUT_BOUND)||MAX_INPUT_BOUND<1000||MAX_INPUT_BOUND>1000000)throw new Error("--max-input-bound must be an integer from 1000 to 1000000");
if(!Number.isInteger(MAX_OUTPUT)||MAX_OUTPUT<1000||MAX_OUTPUT>65536)throw new Error("--max-output-tokens must be an integer from 1000 to 65536");
const CALL_CAP_CNY=(MAX_INPUT_BOUND*2+MAX_OUTPUT*8)/1e6;
// Legacy trial report uses USD fields. This fixed bookkeeping conversion is
// never used for the authoritative CNY budget and is not an exchange-rate quote.
const CNY_PER_BOOK_USD=8;
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
interface CallEntry {taskId:string;attempt:number;state:string;reservedCny:number;accountedCny:number;usage?:unknown;error?:string;returnedModel?:string;runDirectory?:string}

async function main() {
  const taskOption=process.argv.indexOf("--tasks");
  const taskPath=taskOption<0?"scripts/eval/assembly-generation/tasks.json":process.argv[taskOption+1];
  if(!taskPath||taskPath.startsWith("--"))throw new Error("--tasks requires a frozen task-set path");
  const taskBytes=await fs.readFile(taskPath);
  const tasks=loadTaskSet(JSON.parse(taskBytes.toString()));
  const seedOption=process.argv.indexOf("--seed-repair");
  const seedPath=seedOption<0?null:process.argv[seedOption+1];
  if(seedOption>=0&&(!seedPath||seedPath.startsWith("--")))throw new Error("--seed-repair requires a frozen protocol path");
  const seed=seedPath?await loadSeededRepair(seedPath,tasks):null;
  const maxCalls=worstCaseCalls(tasks);
  if(maxCalls*CALL_CAP_CNY>MAX_CNY)throw new Error("Worst-case call reservations exceed authorization");
  const plan={taskPath,seed:seed?.provenance??null,model:MODEL,authorizationPath:AUTHORIZATION_PATH,maxCny:MAX_CNY,maxCalls,maxInputTokenBound:MAX_INPUT_BOUND,maxOutputTokens:MAX_OUTPUT,
    promptSkills:{generation:["scad-coding","scad-planning"],repair:["scad-coding","scad-planning","scad-repair"]},
    reasoningEffort:process.argv.includes("--non-thinking")?"none":"high",
    inputCnyPerMillion:2,outputCnyPerMillion:8,perCallReservationCny:CALL_CAP_CNY,worstCaseCny:maxCalls*CALL_CAP_CNY,
    priorAccountedCny:0,totalAuthorizationWorstCaseCny:maxCalls*CALL_CAP_CNY,
    pricingSource:"https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",taskSetSha256:tasks.taskSetSha256,
    stopConditions:["CNY reservation or call ceiling","two consecutive fully failed tasks","any ambiguous transport billing or missing usage","unknown provider/model or account unavailable"],
    scope:"Real LLM SCAD generation with derived-contract offline geometry judging, not the browser product flow or physical function. Hard-stop overtravel is not evaluated by the legacy judge."};
  if(!process.argv.includes("--run")){
    if(process.argv.includes("--continue-authorized")) {
      const prior=JSON.parse(await fs.readFile(AUTHORIZATION_PATH,"utf8"));
      if(prior.status!=="TERMINAL"||prior.maxCny!==MAX_CNY||prior.model!==MODEL||!Array.isArray(prior.calls))throw new Error("Previous authorization is not terminal or does not match");
      if(prior.calls.some((call:CallEntry)=>!Number.isFinite(call.accountedCny)||call.accountedCny<0))throw new Error("Invalid previous cost ledger");
      plan.priorAccountedCny=prior.calls.reduce((sum:number,call:CallEntry)=>sum+call.accountedCny,0);
      plan.totalAuthorizationWorstCaseCny=plan.priorAccountedCny+plan.worstCaseCny;
      if(plan.totalAuthorizationWorstCaseCny>MAX_CNY)throw new Error("Remaining authorization cannot cover this batch's worst case");
    }
    console.log(JSON.stringify(plan,null,2));return;
  }
  if(process.env.AGENTSCAD_ALLOW_PAID!=="1"||!process.env.AGENTSCAD_PAID_KEY_FILE)throw new Error("Explicit paid authorization and a protected key file are required");
  const key=(await fs.readFile(process.env.AGENTSCAD_PAID_KEY_FILE,"utf8")).trim();
  if(!key)throw new Error("Missing trial credential");
  const provider:ProviderConfig={id:"ephemeral-authorized-deepseek",type:"deepseek",name:"DeepSeek authorized trial",baseUrl:"https://api.deepseek.com",apiKey:key,defaultModel:MODEL,enabled:true,isDefault:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const balance=async()=>{
    const response=await fetch("https://api.deepseek.com/user/balance",{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Balance query failed (${response.status})`);
    const body=await response.json();
    const cny=body.balance_infos?.find((item:{currency:string})=>item.currency==="CNY");
    if(!body.is_available||!cny||!Number.isFinite(Number(cny.total_balance)))throw new Error("CNY account balance unavailable");
    return Number(cny.total_balance);
  };
  const initialBalance=await balance();
  const coding=await loadSkill("scad-coding"),planning=await loadSkill("scad-planning");
  if(!coding||!planning)throw new Error("Missing generation skills");
  const system=[skillInstructions(coding),skillInstructions(planning),
    "For this authorized trial, use only original geometry and OpenSCAD built-in primitives. Do not include external libraries. Preserve the exact user requirements. Return one complete SCAD code block.",
    "For a revolute connection declare boreInstanceId as the instance containing the mating bore. It is an allowed optional connection key. Supply local connection frames and instance transforms consistently. Do not fabricate validation claims.",
    "Mandatory output contract: the response must contain exactly one embedded declaration block. It begins with /* AGENTSCAD_ASSEMBLY_V1, contains one valid JSON object of the assembly contract described above, and ends with END_AGENTSCAD_ASSEMBLY */. A response without that block is rejected before any geometry is measured. When a condition is unknown, record it in the declaration's unknowns or assumptions instead of omitting the declaration.",
    "Declare the revolute motion's source binding (parameter plus a pose selector for every instance), and declare blocked and clear translationProbes along the joint axis when the request asks for axial retention or an independent release. These are declarations measured by the evaluator, not claimed results.",
    "When the request asks for axial retention or an independent release, translationProbes is mandatory, not optional. Each probe needs: id, instanceId, startTransform (the 4x4 world pose of the moving instance), translationMm (three signed millimetres along the joint axis), samples (an integer from 2 to 65), and expected (exactly the string blocked or clear). Include at least one blocked probe starting at a declared working pose and at least one clear probe starting at the released pose from the declared disassembly trajectory. Probes without startTransform, with a non-axial translation, or with the wrong expected value are rejected."].join("\n\n");
  const needsRepair = seed !== null || tasks.tasks.some(task => task.maxRepairs > 0);
  const repair = needsRepair ? await loadSkill("scad-repair") : null;
  if (needsRepair && !repair) throw new Error("Missing repair skill");
  const repairSystem = repair ? [system, skillInstructions(repair),
    "For this trial return one complete SCAD code block containing the declaration. Keep all unresolved conditions explicit.",
    "The repaired declaration is checked against the previous one. These invariants are mandatory:",
    ...ASSEMBLY_REPAIR_INVARIANTS.map(rule => `- ${rule}`)].join("\n\n") : system;
  await fs.mkdir(".agentscad/experiments",{recursive:true});
  const directory=await fs.mkdtemp(path.join(".agentscad/experiments","paid-deepseek-assembly-"));
  // Freeze direct evaluator sources before any paid call, preserving paths.
  const sourceSnapshot:Array<{file:string;sha256:string}>=[];
  for(const file of [...new Set([...ASSEMBLY_VERIFIER_SOURCES,
    "scripts/eval/paid-assembly-trial.ts","scripts/eval/seeded-repair.ts","scripts/eval/generation-trial.ts","scripts/eval/judge-assembly.ts",
    "scripts/eval/assembly-evidence.ts","src/lib/assembly/repair-findings.ts",
    "src/lib/requirements/extract-requirements.ts","src/lib/tools/model-router.ts","src/lib/provider-settings.ts"])]) {
    const source=await fs.readFile(file),destination=path.join(directory,"tools",file);
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,source);
    sourceSnapshot.push({file,sha256:sha(source)});
  }
  await fs.writeFile(path.join(directory,"tools.json"),JSON.stringify({scope:"Listed direct sources; not a hermetic runtime",sources:sourceSnapshot},null,2));
  const calls:CallEntry[]=[];
  const allJudgements:Array<Record<string,unknown>>=[];
  const previous=new Map<string,string>();
  if(seed){
    previous.set(tasks.tasks[0].id,seed.source);
    await fs.writeFile(path.join(directory,"seed-source.scad"),seed.source);
    await fs.writeFile(path.join(directory,"seed-feedback.json"),seed.feedbackBytes);
    await fs.writeFile(path.join(directory,"seed-protocol.json"),seed.protocolBytes);
  }
  let halted:string|null=null;
  // Single-use admission prevents a resumed shell from silently starting a new
  // batch against the same 28 CNY authorization after a process interruption.
  const authorizationPath=AUTHORIZATION_PATH;
  let priorCalls:CallEntry[]=[];
  let authorizationInitialBalance=initialBalance;
  if(process.argv.includes("--continue-authorized")) {
    const prior=JSON.parse(await fs.readFile(authorizationPath,"utf8"));
    if(prior.status!=="TERMINAL"||prior.maxCny!==MAX_CNY||prior.model!==MODEL||!Array.isArray(prior.calls))throw new Error("Previous authorization is not terminal or does not match");
    priorCalls=prior.calls.map((call:CallEntry)=>({...call,runDirectory:call.runDirectory??prior.directory}));
    if(priorCalls.some(c=>!Number.isFinite(c.accountedCny)||c.accountedCny<0))throw new Error("Invalid previous cost ledger");
    authorizationInitialBalance=prior.initialBalance;
  }
  const priorAccountedCny=priorCalls.reduce((sum,c)=>sum+c.accountedCny,0);
  plan.priorAccountedCny=priorAccountedCny;plan.totalAuthorizationWorstCaseCny=priorAccountedCny+maxCalls*CALL_CAP_CNY;
  if(priorAccountedCny+maxCalls*CALL_CAP_CNY>MAX_CNY)throw new Error("Remaining authorization cannot cover this batch's worst case");
  const claimPath=authorizationPath+".active";
  const claim=await fs.open(claimPath,"wx");await claim.close();
  const admission=await fs.open(authorizationPath,process.argv.includes("--continue-authorized")?"w":"wx").catch(async error=>{
    await fs.unlink(claimPath);throw error;
  });
  await admission.writeFile(JSON.stringify({status:"ACTIVE",directory,maxCny:MAX_CNY,model:MODEL,initialBalance:authorizationInitialBalance,calls:priorCalls,accountedCny:priorAccountedCny},null,2));
  await admission.close();
  let terminal=false;
  const ledger=async()=>{
    const current=calls.reduce((sum,c)=>sum+c.accountedCny,0);
    const data={currency:"CNY",maxCny:MAX_CNY,calls,accountedCny:current,priorAccountedCny,totalAuthorizationAccountedCny:priorAccountedCny+current,initialBalance,halted};
    await fs.writeFile(path.join(directory,"ledger.json"),JSON.stringify(data,null,2));
    await fs.writeFile(authorizationPath,JSON.stringify({...data,calls:[...priorCalls,...calls],accountedCny:priorAccountedCny+current,initialBalance:authorizationInitialBalance,directory,status:terminal?"TERMINAL":"ACTIVE",model:MODEL},null,2));
  };
  await Promise.all([fs.writeFile(path.join(directory,"plan.json"),JSON.stringify(plan,null,2)),fs.writeFile(path.join(directory,"tasks.json"),taskBytes),fs.writeFile(path.join(directory,"system-prompt.txt"),system),fs.writeFile(path.join(directory,"repair-system-prompt.txt"),repairSystem)]);
  console.log(JSON.stringify({directory,plan},null,2));
  const legacyPlan=planTrial({taskSet:tasks,pricePerCallUsd:CALL_CAP_CNY/CNY_PER_BOOK_USD,maxCalls,maxUsd:(MAX_CNY-priorAccountedCny)/CNY_PER_BOOK_USD});
  const report=await withLlmCallMeter(async()=>{
    const trial=await runTrial({taskSet:tasks,plan:legacyPlan,mode:"paid",model:MODEL,deps:{
      generate:async(task,attempt,repairPrompt)=>{
        if(halted)throw new TrialRefused(halted);
        const accounted=calls.reduce((sum,c)=>sum+c.accountedCny,0);
        if(calls.length>=maxCalls||priorAccountedCny+accounted+CALL_CAP_CNY>MAX_CNY)throw new TrialRefused("Authorized budget exhausted");
        const old=previous.get(task.id);
        const content=attempt===0&&!seed?task.prompt:`Original request: ${task.prompt}\n\nRepair the complete previous SCAD. Preserve required parts, connections, range and clearance.\n\n${old??""}\n\nMeasured feedback:\n${focusRepairFeedback(repairPrompt??seed?.feedback??"No measurement available",2)}`;
        const messages=[{role:"system" as const,content:old ? repairSystem : system},{role:"user" as const,content}];
        const tokenBound=Buffer.byteLength(JSON.stringify(messages),"utf8")+1024;
        if(tokenBound>MAX_INPUT_BOUND)throw new TrialRefused("Prompt byte-derived token reservation exceeded");
        if(await balance()<CALL_CAP_CNY)throw new TrialRefused("Available CNY balance below next-call reservation");
        const prefix=path.join(directory,`${task.id}-${attempt}`);
        await fs.writeFile(`${prefix}-request.json`,JSON.stringify({model:MODEL,messages,max_tokens:MAX_OUTPUT,reasoning_effort:plan.reasoningEffort,stream:true,tokenBound},null,2));
        const entry:CallEntry={taskId:task.id,attempt,state:"RESERVED",reservedCny:CALL_CAP_CNY,accountedCny:CALL_CAP_CNY,runDirectory:directory};
        calls.push(entry);await ledger();
        console.log(JSON.stringify({task:task.id,attempt,state:"MODEL_REQUEST",reservationCny:CALL_CAP_CNY}));
        try {
          const completion=await createChatCompletionDetailed({model:MODEL,messages,providerOverride:provider,maxOutputTokens:MAX_OUTPUT,reasoningEffort:plan.reasoningEffort as "none"|"high",stream:true,signal:AbortSignal.timeout(600000)});
          const {reasoningContent,...publicCompletion}=completion;
          await fs.writeFile(`${prefix}-response.json`,JSON.stringify({...publicCompletion,reasoningCharacters:reasoningContent?.length??0},null,2));
          entry.usage=completion.usage;entry.returnedModel=completion.model;
          if(![MODEL,"deepseek-flash","deepseek-v4.1-flash-1017"].includes(completion.model.toLowerCase())) {
            halted="Provider returned an unexpected model; remaining calls stopped";
            throw new Error(halted);
          }
          const input=completion.usage?.promptTokens,output=completion.usage?.completionTokens;
          if(input===undefined||output===undefined||input>MAX_INPUT_BOUND||output>MAX_OUTPUT||input<0||output<0) {
            halted="Missing or out-of-reservation usage; remaining calls stopped";
            throw new Error(halted);
          }
          entry.accountedCny=(input*2+output*8)/1e6;
          entry.state="COMPLETED";await ledger();
          const source=extractOpenScadCodeFromText(completion.content);
          if(!source)throw new Error("Model response contains no complete SCAD artifact");
          const scad=sanitizeGeneratedScadSource(source);
          await fs.writeFile(`${prefix}.scad`,scad);
          previous.set(task.id,scad);
          return {scad,calls:1,usd:entry.accountedCny/CNY_PER_BOOK_USD};
        } catch(error) {
          if(error instanceof ModelRequestError) {
            const usage=error.evidence?.usage;
            if(usage?.promptTokens!==undefined&&usage.completionTokens!==undefined&&usage.promptTokens<=MAX_INPUT_BOUND&&usage.completionTokens<=MAX_OUTPUT) {
              entry.usage=usage;entry.accountedCny=(usage.promptTokens*2+usage.completionTokens*8)/1e6;
            }
            await fs.writeFile(`${prefix}-model-error.json`,JSON.stringify({code:error.code,message:error.message,evidence:error.evidence},null,2));
          }
          entry.state=entry.state==="COMPLETED"?"OUTPUT_ERROR":"REQUEST_ERROR";
          entry.error=String(error).replaceAll(key,"[REDACTED]");
          halted??="Provider/output failure; no automatic retry or further paid request";
          await ledger();throw new Error(entry.error);
        }
      },
      judge:async(task,scad)=>{
        const attempt=calls.filter(c=>c.taskId===task.id).at(-1)!.attempt;
        const prefix=path.join(directory,`${task.id}-${attempt}`);
        const current=extractEmbeddedAssemblySpec(scad);
        if(attempt>0||seed) {
          const oldSource=attempt>0?await fs.readFile(path.join(directory,`${task.id}-${attempt-1}.scad`),"utf8"):seed!.source;
          const old=extractEmbeddedAssemblySpec(oldSource);
          if(old.status==="valid") {
            const guard=assertRepairPreservesAssembly({before:old.spec,after:current.status==="valid"?current.spec:null,contract:deriveRequirementContract({request:task.prompt})});
            if(!guard.ok) {
              const blocked={passed:false,contractSha256:"",evidence:[{id:"repair-preservation",status:"FAIL"}],findings:guard.violations.map(v=>v.message)};
              allJudgements.push({taskId:task.id,attempt,...blocked});
              await fs.writeFile(`${prefix}-judgement.json`,JSON.stringify(blocked,null,2));return blocked;
            }
          }
        }
        let identityStatus:string|null=null;
        try {
          const judged=await judgeAssemblyCandidate({prompt:task.prompt,scad,onDiagnostics:async({report,parts})=>{
            await fs.writeFile(`${prefix}-diagnostics.json`,JSON.stringify(report,null,2));
            await Promise.all(parts.map(part=>fs.writeFile(`${prefix}-diagnostic-${part.partId}.stl`,part.stl)));
          },onPrepared:async(prepared,whole)=>{
            identityStatus=prepared.manifest.evidence.identity.status;
            await fs.writeFile(`${prefix}-manifest.json`,JSON.stringify(prepared.manifest,null,2));
            await fs.writeFile(`${prefix}-assembly.stl`,whole.stl);
            await Promise.all(prepared.parts.map(part=>fs.writeFile(`${prefix}-${part.partId}.stl`,part.stl)));
          }});
          if(identityStatus&&identityStatus!=="PASS") {
            judged.passed=false;
            if(!judged.evidence.some(item=>item.id==="measured-part-identity"))judged.evidence.push({id:"measured-part-identity",status:identityStatus});
            judged.findings.push(`Part identity is ${identityStatus}; it cannot count as passed.`);
          }
          const scoped={taskId:task.id,attempt,...judged,hardStopOvertravel:"NOT_RUN",hardStopReason:"Applicability and overtravel geometry are not evaluated by this judge; absence of keywords cannot establish non-applicability.",physical:"NOT_RUN",userAcceptance:"NOT_RUN"};
          allJudgements.push(scoped);
          await fs.writeFile(`${prefix}-judgement.json`,JSON.stringify(scoped,null,2));
          console.log(JSON.stringify({task:task.id,attempt,state:"JUDGED",passed:judged.passed,evidence:judged.evidence}));
          return judged;
        } catch(error) {
          await fs.writeFile(`${prefix}-judge-error.json`,JSON.stringify({status:"ERROR",error:String(error).replaceAll(key,"[REDACTED]")}));
          throw error;
        }
      },
    }});
    // Reconcile failed request charges as well; the legacy runner only receives
    // usage for calls that successfully returned an artifact.
    for(const task of trial.tasks) {
      const taskCalls=calls.filter(c=>c.taskId===task.id);
      task.calls=taskCalls.length;task.usd=taskCalls.reduce((s,c)=>s+c.accountedCny,0)/CNY_PER_BOOK_USD;
    }
    trial.budget.calls=calls.length;trial.budget.usd=calls.reduce((s,c)=>s+c.accountedCny,0)/CNY_PER_BOOK_USD;
    return {...trial,meteredLlmCalls:llmCallsThisRun()};
  });
  const finalBalance=await balance().catch(()=>null);
  const currentCost=calls.reduce((s,c)=>s+c.accountedCny,0);
  const result={...report,cnyAccounting:{maxCny:MAX_CNY,peakPriceUpperEstimate:currentCost,priorAccountedCny,totalAuthorizationUpperEstimate:priorAccountedCny+currentCost,initialBalance,finalBalance,balanceDifference:finalBalance===null?null:initialBalance-finalBalance,legacyBookkeepingCnyPerUsd:CNY_PER_BOOK_USD},coverageExclusions:["physical function","user acceptance","hard-stop overtravel","browser product end-to-end flow","continuous collision"],allJudgements};
  await fs.writeFile(path.join(directory,"report.json"),JSON.stringify(result,null,2));
  const codeUnchangedDuringRun=(await Promise.all(sourceSnapshot.map(async item=>sha(await fs.readFile(item.file))===item.sha256))).every(Boolean);
  await fs.writeFile(path.join(directory,"provenance.json"),JSON.stringify({taskBytesSha256:sha(taskBytes),systemPromptSha256:sha(system),repairSystemPromptSha256:sha(repairSystem),runtime:Bun.version,scope:plan.scope,codeUnchangedDuringRun},null,2));
  terminal=true;await ledger();await fs.unlink(claimPath);
  console.log(JSON.stringify({directory,summary:report.summary,cnyAccounting:result.cnyAccounting,meteredLlmCalls:report.meteredLlmCalls},null,2));
}
if(import.meta.main)main().catch(error=>{console.error(String(error));process.exitCode=1;});
