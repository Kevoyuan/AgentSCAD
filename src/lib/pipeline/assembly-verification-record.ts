import { randomUUID } from "node:crypto";
import { db } from "../db";
import { canonicalJson,sha256Hex } from "../canonical-json";
import { assemblyRecordId,assemblySourceHash } from "./assembly-spec-record";
import { requirementRecordId,readRequirementContract,type RequirementContractRecord } from "../requirements/requirement-contract-record";
import { EXECUTION_TTL_MS,JOB_EXECUTION_FIELD } from "./job-execution";
import { assemblyVerifierIdentity } from "../assembly/verification-fingerprint";
import { validateAssemblySpec } from "../assembly/assembly-spec";
import { assemblySpecificationHash } from "../assembly/spec-hash";
import { RequirementContractSchema,requirementContractHash } from "../requirements/requirement-contract";
import { ASSEMBLY_VERIFICATION_FIELD,ASSEMBLY_VERIFICATION_POINTER_FIELD,StoredAssemblyVerificationSchema,VerificationManifestSchema,unexecutedAssemblyEvidence,type AssemblyVerificationView,type VerificationBinding } from "../assembly/verification-types";

const pointerId=(jobId:string)=>`assembly-evidence-current:${jobId}`;
type JobSnapshot={id:string;scadSource:string|null;inputRequest:string;state:string};
type Pointer={id:string;newValue:string|null;createdAt:Date;field:string};
const signature=(row:Pointer|undefined)=>sha256Hex(canonicalJson(row?{value:row.newValue,createdAt:row.createdAt.toISOString(),field:row.field}:null));
export class AssemblyVerificationConflict extends Error {}
export interface VerificationContext {
  job:JobSnapshot;binding:VerificationBinding;pointers:Pointer[];
  verifier:Awaited<ReturnType<typeof assemblyVerifierIdentity>>;
  inputs:{source:string;request:string;specification:unknown;requirements:unknown};
}

/** Called after authorization, under the export/verification execution lease. */
export async function captureVerificationContext(job:JobSnapshot,specSha256:string,requirements:RequirementContractRecord,specification?:unknown):Promise<VerificationContext> {
  const pointers=await db.jobVersion.findMany({where:{id:{in:[assemblyRecordId(job.id),requirementRecordId(job.id)]}},select:{id:true,newValue:true,createdAt:true,field:true}});
  const artifact=await db.jobArtifactVersion.findFirst({where:{jobId:job.id,scadHash:assemblySourceHash(job.scadSource)!},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true}});
  const verifier=await assemblyVerifierIdentity();
  return {job:{...job},pointers,verifier,inputs:{source:job.scadSource??"",request:job.inputRequest,specification,requirements:requirements.contract},binding:{sourceSha256:assemblySourceHash(job.scadSource)!,specSha256,
    requestSha256:sha256Hex(job.inputRequest.trim()),contractSha256:requirements.contractSha256,
    assemblyVersionToken:signature(pointers.find(row=>row.id===assemblyRecordId(job.id))),
    requirementVersionToken:signature(pointers.find(row=>row.id===requirementRecordId(job.id))),
    artifactVersionId:artifact?.id??null,verifierFingerprint:verifier.fingerprint}};
}

/** Append-only evidence plus an atomic latest pointer. Does not edit job metrics or outcomes. */
export async function saveAssemblyVerification(input:{context:VerificationContext;leaseToken:string;startedAt:Date;producer:"check"|"bundle";manifest?:unknown;error?:string}) {
  const {context}=input;
  const afterVerifier=await assemblyVerifierIdentity();
  if(afterVerifier.fingerprint!==context.verifier.fingerprint)throw new AssemblyVerificationConflict("Verification tools changed while checking");
  const manifest=input.manifest===undefined?null:VerificationManifestSchema.parse(input.manifest);
  const spec=validateAssemblySpec(context.inputs.specification);
  const contract=RequirementContractSchema.parse(context.inputs.requirements);
  if(!spec.success||assemblySpecificationHash(spec.data)!==context.binding.specSha256||requirementContractHash(contract)!==context.binding.contractSha256)throw new AssemblyVerificationConflict("Input snapshots do not match the verification binding");
  if(manifest&&(manifest.sourceSha256!==context.binding.sourceSha256||manifest.specificationSha256!==context.binding.specSha256))throw new AssemblyVerificationConflict("Report does not match the checked source and assembly");
  const id=`assembly-evidence:${context.job.id}:${randomUUID()}`,completedAt=new Date();
  const record=StoredAssemblyVerificationSchema.parse({schemaVersion:1,id,binding:context.binding,startedAt:input.startedAt.toISOString(),completedAt:completedAt.toISOString(),durationMs:Math.max(0,completedAt.getTime()-input.startedAt.getTime()),producer:input.producer,
    execution:{status:manifest?"COMPLETED":"ERROR",message:manifest?null:(input.error??"Verification did not complete").slice(0,2000)},inputs:context.inputs,manifest,originalMeshesRetained:false,verifier:context.verifier});
  const reportSha256=sha256Hex(canonicalJson(record));
  const payload=JSON.stringify({record,reportSha256});
  if(Buffer.byteLength(payload)>2*1024*1024)throw new Error("Verification report exceeds its storage budget");
  await db.$transaction(async tx=>{
    const job=await tx.job.findUnique({where:{id:context.job.id},select:{scadSource:true,inputRequest:true,state:true}});
    const lock=await tx.jobVersion.findUnique({where:{id:`execution:${context.job.id}`}});
    if(!job||job.scadSource!==context.job.scadSource||job.inputRequest!==context.job.inputRequest||job.state!==context.job.state||lock?.field!==JOB_EXECUTION_FIELD||lock.newValue!==input.leaseToken||lock.createdAt.getTime()<Date.now()-EXECUTION_TTL_MS)throw new AssemblyVerificationConflict("Job or verification lease changed");
    const pointers=await tx.jobVersion.findMany({where:{id:{in:[assemblyRecordId(context.job.id),requirementRecordId(context.job.id)]}},select:{id:true,newValue:true,createdAt:true,field:true}});
    for(const key of [assemblyRecordId(context.job.id),requirementRecordId(context.job.id)])if(signature(pointers.find(row=>row.id===key))!==signature(context.pointers.find(row=>row.id===key)))throw new AssemblyVerificationConflict("Assembly description or confirmed requirements changed");
    const artifact=await tx.jobArtifactVersion.findFirst({where:{jobId:context.job.id,scadHash:context.binding.sourceSha256},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true}});
    if((artifact?.id??null)!==context.binding.artifactVersionId)throw new AssemblyVerificationConflict("Artifact version changed while checking");
    await tx.jobVersion.create({data:{id,jobId:context.job.id,field:ASSEMBLY_VERIFICATION_FIELD,changedBy:"system",newValue:payload}});
    await tx.jobVersion.upsert({where:{id:pointerId(context.job.id)},create:{id:pointerId(context.job.id),jobId:context.job.id,field:ASSEMBLY_VERIFICATION_POINTER_FIELD,changedBy:"system",newValue:id},update:{newValue:id,createdAt:completedAt}});
  });
  return {id,reportSha256,record};
}

/** Read only after the caller has checked browser/job scope. Old reports remain downloadable. */
export async function readAssemblyVerification(job:JobSnapshot,declaration:{specSha256:string|null;stale:boolean},reportId?:string) {
  const absent=()=>({verification:{status:"ABSENT"} as AssemblyVerificationView,evidence:unexecutedAssemblyEvidence(),record:null,reportSha256:null});
  const pointer=reportId?null:await db.jobVersion.findUnique({where:{id:pointerId(job.id)}});
  const id=reportId??(pointer?.field===ASSEMBLY_VERIFICATION_POINTER_FIELD?pointer.newValue:null);
  if(!id)return absent();
  const row=await db.jobVersion.findFirst({where:{id,jobId:job.id,field:ASSEMBLY_VERIFICATION_FIELD}});
  if(!row)return {...absent(),verification:{status:"UNAVAILABLE",reason:"The saved verification report is unavailable."} as AssemblyVerificationView};
  try {
    if(!row.newValue||Buffer.byteLength(row.newValue)>2*1024*1024)throw new Error("Invalid stored report size");
    const envelope=JSON.parse(row.newValue);
    const record=StoredAssemblyVerificationSchema.parse(envelope.record);
    const reportSha256=sha256Hex(canonicalJson(record));
    if(envelope.reportSha256!==reportSha256||record.id!==row.id)throw new Error("Report fingerprint mismatch");
    const spec=validateAssemblySpec(record.inputs.specification),contract=RequirementContractSchema.parse(record.inputs.requirements);
    if(!spec.success||assemblySpecificationHash(spec.data)!==record.binding.specSha256||requirementContractHash(contract)!==record.binding.contractSha256||sha256Hex(record.inputs.source)!==record.binding.sourceSha256||sha256Hex(record.inputs.request.trim())!==record.binding.requestSha256)throw new Error("Stored input snapshots do not match their fingerprints");
    const requirements=await readRequirementContract(job.id,job.inputRequest);
    const current=declaration.specSha256?await captureVerificationContext(job,declaration.specSha256,requirements):null;
    const unavailable=!current?.verifier.fingerprint;
    const latestJob=await db.job.findUnique({where:{id:job.id},select:{scadSource:true,inputRequest:true,state:true}});
    const jobChanged=!latestJob||latestJob.scadSource!==job.scadSource||latestJob.inputRequest!==job.inputRequest||latestJob.state!==job.state;
    const stale=jobChanged||declaration.stale||!current||canonicalJson(current.binding)!==canonicalJson(record.binding);
    const verification:AssemblyVerificationView={status:unavailable?"UNAVAILABLE":stale?"STALE":"CURRENT",id:record.id,completedAt:record.completedAt,durationMs:record.durationMs,executionStatus:record.execution.status,executionMessage:record.execution.message,reportSha256,originalMeshesRetained:false,
      ...(unavailable?{reason:"The verification tool version could not be checked."}:stale?{reason:"The source, assembly, requirements, artifact version or verification tools changed. Run the checks again."}:{})};
    return {verification,evidence:verification.status==="CURRENT"&&record.manifest?record.manifest.evidence:unexecutedAssemblyEvidence(),record,reportSha256};
  } catch {
    return {...absent(),verification:{status:"UNAVAILABLE",reason:"The saved verification report could not be validated."} as AssemblyVerificationView};
  }
}
