/**
 * Immutable on-demand A07 attempt ledger, separate from JobOutcome, SCAD edits,
 * approval and delivery. A failed or abandoned repair is a record, never PASS.
 *
 * Caller MUST authorize session and hold a versioned Job execution lease first.
 * No stored source/attempt may silently overwrite the delivered original.
 */
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { db } from "../db";
import type { RepairLoopAttempt, RepairLoopStop } from "./repair-loop";

export const ASSEMBLY_REPAIR_LEDGER_FIELD = "__assembly_repair_event";
export const ASSEMBLY_REPAIR_CHECKER_VERSION = "assembly-measured-repair/v1";
const MAX_EVENT_BYTES = 400_000;
const SHA=/^[0-9a-f]{64}$/;
const sha256=(v:string)=>createHash("sha256").update(v).digest("hex");

export type RepairEventState = "STARTED"|"ATTEMPT"|"FINISHED"|"ABORTED"|"ERROR";
type StoredBase = {
  schemaVersion: 1;
  checkerVersion: typeof ASSEMBLY_REPAIR_CHECKER_VERSION;
  jobId:string;
  runId:string;
  eventIndex:number;
  state:RepairEventState;
  recordedAt:string;
  sourceSha256:string;
  specificationSha256:string;
  contractSha256:string;
  requirementFingerprint:string;
  attempt:RepairLoopAttempt|null;
  terminal:{
    stoppedBecause:RepairLoopStop|"error";
    reason:string;
    finalScadSha256:string;
    evidenceComplete:boolean;
    /** Accepted candidate is persisted for review; NEVER automatically applied. */
    reviewCandidateScad:string|null;
  }|null;
};
export type StoredAssemblyRepairEvent = StoredBase & { eventSha256:string };
export type RepairLedgerBinding = Pick<StoredBase,"jobId"|"runId"|"sourceSha256"|"specificationSha256"|"contractSha256"|"requirementFingerprint">;

export function createRepairEvent(input: RepairLedgerBinding & {
  eventIndex:number;
  state:RepairEventState;
  attempt?:RepairLoopAttempt|null;
  terminal?:StoredBase["terminal"];
  recordedAt?:string;
}):StoredAssemblyRepairEvent {
  if (!SHA.test(input.sourceSha256)||!SHA.test(input.specificationSha256)||
    !SHA.test(input.contractSha256)||!SHA.test(input.requirementFingerprint)||
    !/^[0-9a-f-]{36}$/.test(input.runId)||
    !Number.isSafeInteger(input.eventIndex)||input.eventIndex<0||input.eventIndex>24) {
    throw new Error("Invalid repair provenance binding");
  }
  const base:StoredBase={
    schemaVersion:1,checkerVersion:ASSEMBLY_REPAIR_CHECKER_VERSION,
    jobId:input.jobId,runId:input.runId,eventIndex:input.eventIndex,
    state:input.state,recordedAt:input.recordedAt??new Date().toISOString(),
    sourceSha256:input.sourceSha256,specificationSha256:input.specificationSha256,
    contractSha256:input.contractSha256,requirementFingerprint:input.requirementFingerprint,
    attempt:input.attempt??null,terminal:input.terminal??null,
  };
  if ((base.state==="ATTEMPT") !== (base.attempt!==null)||
    (["FINISHED","ABORTED","ERROR"].includes(base.state)) !== (base.terminal!==null)) {
    throw new Error("Inconsistent repair attempt/terminal event");
  }
  if(base.terminal?.reviewCandidateScad &&
    Buffer.byteLength(base.terminal.reviewCandidateScad,"utf8")>256*1024)
    throw new Error("Stored repair candidate exceeds 256 KiB");
  const event={...base,eventSha256:sha256(canonicalJson(base))};
  if(Buffer.byteLength(JSON.stringify(event),"utf8")>MAX_EVENT_BYTES)throw new Error("Repair event exceeds 400 KiB");
  return event;
}
export function parseRepairEvent(value:unknown):StoredAssemblyRepairEvent|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const e=value as Partial<StoredAssemblyRepairEvent>;
  if(e.schemaVersion!==1||e.checkerVersion!==ASSEMBLY_REPAIR_CHECKER_VERSION||
    typeof e.jobId!=="string"||typeof e.runId!=="string"||
    !Number.isSafeInteger(e.eventIndex)||typeof e.state!=="string"||
    typeof e.recordedAt!=="string"||!Number.isFinite(Date.parse(e.recordedAt))||
    !e.sourceSha256||!SHA.test(e.sourceSha256)||
    !e.specificationSha256||!SHA.test(e.specificationSha256)||
    !e.contractSha256||!SHA.test(e.contractSha256)||
    !e.requirementFingerprint||!SHA.test(e.requirementFingerprint)||
    !e.eventSha256||!SHA.test(e.eventSha256))return null;
  const {eventSha256,...base}=e;
  return sha256(canonicalJson(base))===eventSha256 ? e as StoredAssemblyRepairEvent:null;
}
/** Append ONLY. Uses a unique row, not the mutable Job's repairHistory. */
export async function appendRepairEvent(event:StoredAssemblyRepairEvent) {
  if(!parseRepairEvent(event))throw new Error("Cannot append a corrupt repair event");
  return db.jobVersion.create({
    data:{
      id:"assembly-repair:"+event.jobId+":"+event.runId+":"+event.eventIndex+":"+randomUUID(),
      jobId:event.jobId,field:ASSEMBLY_REPAIR_LEDGER_FIELD,
      newValue:JSON.stringify(event),changedBy:"system",
    },
    select:{id:true,createdAt:true},
  });
}
/** Session authorization is the caller's responsibility; never expose to anonymous users. */
export async function readRepairEvents(jobId:string, context:{
  sourceSha256:string;
  specificationSha256:string;
  contractSha256:string;
  requirementFingerprint:string;
},limit=20) {
  const take=Number.isSafeInteger(limit)?Math.max(1,Math.min(40,limit)):20;
  const rows=await db.jobVersion.findMany({
    where:{jobId,field:ASSEMBLY_REPAIR_LEDGER_FIELD},
    orderBy:[{createdAt:"desc"},{id:"desc"}],take,
  });
  return rows.map(row=>{
    let event:StoredAssemblyRepairEvent|null=null;
    try{event=parseRepairEvent(JSON.parse(row.newValue??""));}catch{}
    if(!event||event.jobId!==jobId)return {id:row.id,integrity:"ERROR" as const,bindingCurrent:false,event:null};
    return {
      id:row.id,integrity:"PASS" as const,
      bindingCurrent:event.sourceSha256===context.sourceSha256&&
        event.specificationSha256===context.specificationSha256&&
        event.contractSha256===context.contractSha256&&
        event.requirementFingerprint===context.requirementFingerprint,
      event,
    };
  });
}
