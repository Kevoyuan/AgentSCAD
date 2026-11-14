import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { lockAssemblyExport, AssemblyExportRejection } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";
import { readAssemblySpecification } from "@/lib/pipeline/assembly-spec-record";
import { readRequirementContract } from "@/lib/requirements/requirement-contract-record";
import { fingerprintRequirementState } from "@/lib/assembly/evidence-snapshot-record";
import { runProductionAssemblyRepair, AssemblyRepairUnsupported } from "@/lib/assembly/assembly-repair-job";
import {
  ASSEMBLY_REPAIR_CHECKER_VERSION, appendRepairEvent,
  createRepairEvent, readRepairEvents, type RepairLedgerBinding,
  type RepairEventState,
} from "@/lib/assembly/repair-ledger";

export const maxDuration=300;
type Context={params:Promise<{id:string}>};
const HASH=z.string().regex(/^[a-f0-9]{64}$/);
const Body=z.object({
  sourceSha256:HASH,specSha256:HASH,
  confirmedPaidModelCalls:z.literal(true),
  maxAttempts:z.union([z.literal(1),z.literal(2)]),
}).strict();
class RepairDeadline extends Error{}
const TOTAL_MS=240_000;

/** A bounded, explicitly paid/opted-in request; cannot be triggered by GET. */
async function readBody(request:NextRequest) {
  if(Number(request.headers.get("content-length")??0)>2048)
    throw new AssemblyRepairUnsupported("A07 request exceeds the 2 KiB limit.");
  if(!request.body)throw new AssemblyRepairUnsupported("JSON request body is required.");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.length;
      if(length>2048)throw new AssemblyRepairUnsupported("A07 request exceeds the 2 KiB limit.");
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let i=0;
  for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  catch{throw new AssemblyRepairUnsupported("A07 requires a valid JSON request.");}
}

async function completeWithinDeadline<T>(leaseSignal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>) {
  if(leaseSignal.aborted)throw new JobExecutionStopped();
  const started=performance.now();
  const controller=new AbortController();
  let timedOut=false;
  const onLease=()=>controller.abort(leaseSignal.reason);
  leaseSignal.addEventListener("abort",onLease,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort(new RepairDeadline());},TOTAL_MS);
  try{
    const result=await task(controller.signal);
    if(leaseSignal.aborted)throw new JobExecutionStopped();
    if(timedOut||performance.now()-started>=TOTAL_MS)throw new RepairDeadline();
    return result;
  }catch(error){
    if(leaseSignal.aborted)throw new JobExecutionStopped();
    if(timedOut||performance.now()-started>=TOTAL_MS)throw new RepairDeadline();
    throw error;
  }finally{
    clearTimeout(timer);
    leaseSignal.removeEventListener("abort",onLease);
  }
}

export async function POST(request:NextRequest,{params}:Context) {
  const {id}=await params;
  let lease:Awaited<ReturnType<typeof lockAssemblyExport>>|undefined;
  let binding:RepairLedgerBinding|undefined;
  let eventIndex=0;
  let hasTerminal=false;
  const persist=async(state:RepairEventState,options:{
    attempt?:Parameters<typeof createRepairEvent>[0]["attempt"];
    terminal?:Parameters<typeof createRepairEvent>[0]["terminal"];
  }={})=>{
    if(!binding)throw new Error("No frozen repair binding");
    const event=createRepairEvent({...binding,eventIndex:eventIndex++,state,...options});
    await appendRepairEvent(event);
    if(["FINISHED","ERROR","ABORTED"].includes(state))hasTerminal=true;
    return event;
  };
  try{
    const body=Body.safeParse(await readBody(request));
    if(!body.success)throw new AssemblyRepairUnsupported(
      "Provide current hashes, one or two attempts, and explicitly opt into possible paid model calls.");
    const {sourceSha256,specSha256,maxAttempts}=body.data;
    lease=await lockAssemblyExport({request,jobId:id,sourceSha256,specSha256});
    if(!lease.requirements.evidenceCurrent)
      throw new AssemblyExportRejection(409,"Confirm the current user requirement contract before requesting geometry repair.");
    if(!lease.job.scadSource)throw new AssemblyExportRejection(409,"Delivered source is missing");
    const requirementFingerprint=fingerprintRequirementState(lease.requirements);
    binding={
      jobId:id,runId:randomUUID(),sourceSha256,specificationSha256:specSha256,
      contractSha256:lease.requirements.contractSha256,requirementFingerprint,
    };
    await persist("STARTED");
    const result=await completeWithinDeadline(lease.signal,async signal=>
      runProductionAssemblyRepair({
        originalRequest:lease!.job.inputRequest,
        scadSource:lease!.job.scadSource!,
        spec:lease!.spec,contract:lease!.requirements.contract,
        modelId:lease!.job.modelId,maxAttempts,signal,
        onAttempt:async attempt=>{await persist("ATTEMPT",{attempt});},
      }),
    );
    await lease.verifyUnchanged();
    const hasCandidate=result.finalScadSha256!==sourceSha256 &&
      result.findings.length===0 && ["no-findings","incomplete-evidence"].includes(result.stoppedBecause);
    const candidate=hasCandidate?result.finalScad:null;
    const terminal=await persist("FINISHED",{terminal:{
      stoppedBecause:result.stoppedBecause,reason:result.reason,
      finalScadSha256:result.finalScadSha256,
      evidenceComplete:result.evidenceComplete,
      reviewCandidateScad:candidate,
    }});
    return NextResponse.json({
      schemaVersion:1,checkerVersion:ASSEMBLY_REPAIR_CHECKER_VERSION,
      runId:binding.runId,terminalEventSha256:terminal.eventSha256,
      sourceSha256,specSha256,
      contractSha256:binding.contractSha256,
      requirementFingerprint,
      attempts:result.attempts,
      findings:result.findings,
      stoppedBecause:result.stoppedBecause,
      reason:result.reason,evidenceComplete:result.evidenceComplete,
      verifiedCandidate:hasCandidate?{
        scadSource:candidate,scadSha256:result.finalScadSha256,
        allRepairFindingsClosed:true,
        incompleteEvidence:!result.evidenceComplete,
        /** Not auto-applied or automatically approved by the user. */
        applied:false,userAccepted:false,
      }:null,
      deliveryChanged:false,physicalFunctionApproval:"NOT_RUN",
      limitations:"Measured source/part repair candidate only; not saved as the delivered Job. Manual review and explicit SCAD apply/rebuild required. No physical function or unmeasured layer was approved.",
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(binding&&!hasTerminal){
      const aborted=error instanceof JobExecutionStopped || error instanceof RepairDeadline;
      try{await persist(aborted?"ABORTED":"ERROR",{terminal:{
        stoppedBecause:aborted?"aborted":"error",reason:error instanceof Error?error.message:"Repair execution failed",
        finalScadSha256:binding.sourceSha256,evidenceComplete:false,
        reviewCandidateScad:null,
      }});}catch(logError){console.error("Failed to append failed A07 repair event",logError);}
    }
    if(error instanceof AssemblyRepairUnsupported)
      return NextResponse.json({error:error.message},{status:422});
    if(error instanceof AssemblyExportRejection)
      return NextResponse.json({error:error.message},{status:error.status});
    if(error instanceof JobExecutionConflict||error instanceof JobExecutionStopped)
      return NextResponse.json({error:"Job or repair lease changed; results were not approved"},{status:409});
    if(error instanceof RepairDeadline)
      return NextResponse.json({error:"A07 repair exceeded the 240-second execution budget; no candidate was approved"},{status:503,headers:{"Retry-After":"30"}});
    console.error("A07 repair failed",error);
    return NextResponse.json({error:"Measured assembly repair failed; original delivery remains unchanged"},{status:500});
  }finally{
    if(lease)await lease.stop();
  }
}

/** History is read-only, scoped to the same browser session as the CAD Job. */
export async function GET(request:NextRequest,{params}:Context){
  const {id}=await params;
  const access=await getJobAccessScope(request);
  if(!access)return NextResponse.json({error:"Browser session required"},{status:401});
  const job=await db.job.findFirst({where:{id,...jobAccessFilter(access)}});
  if(!job)return NextResponse.json({error:"Job not found"},{status:404});
  const spec=job.scadSource?await readAssemblySpecification(id,job.scadSource):null;
  const requirements=await readRequirementContract(id,job.inputRequest);
  const history=await readRepairEvents(id,{
    sourceSha256:spec?.sourceSha256??"",
    specificationSha256:spec?.specSha256??"",
    contractSha256:requirements.contractSha256,
    requirementFingerprint:fingerprintRequirementState(requirements),
  },20);
  return NextResponse.json({
    schemaVersion:1,checkerVersion:ASSEMBLY_REPAIR_CHECKER_VERSION,
    events:history.map(item=>({
      ...item,
      // Only expose saved candidate source when bound to the current exact
      // user-confirmed version; stale history remains inspectable by digest.
      event:item.event&&item.bindingCurrent?item.event:
        item.event?{...item.event,terminal:item.event.terminal?
          {...item.event.terminal,reviewCandidateScad:null}:null}:null,
    })),
  },{headers:{"Cache-Control":"no-store"}});
}
