import { NextRequest,NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope,jobAccessFilter } from "@/lib/job-session";
import { readAssemblySpecification } from "@/lib/pipeline/assembly-spec-record";
import { lockAssemblyExport,AssemblyExportRejection,JobExecutionConflict,JobExecutionStopped } from "@/lib/pipeline/assembly-export-guard";
import { readAssemblyVerification,AssemblyVerificationConflict } from "@/lib/pipeline/assembly-verification-record";
import { prepareContractAssembly } from "@/lib/assembly/prepare-contract-assembly";

export const maxDuration=300;
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context) {
  const access=await getJobAccessScope(request);
  if(!access)return NextResponse.json({error:"Browser session required"},{status:401});
  const {id}=await params;
  const job=await db.job.findFirst({where:{id,...jobAccessFilter(access)}});
  if(!job)return NextResponse.json({error:"Job not found"},{status:404});
  const reportId=new URL(request.url).searchParams.get("reportId")??undefined;
  if(reportId&&reportId.length>200)return NextResponse.json({error:"Invalid report ID"},{status:400});
  const declaration=await readAssemblySpecification(id,job.scadSource);
  const report=await readAssemblyVerification(job,declaration,reportId);
  if(reportId&&!report.record)return NextResponse.json({error:"Report not found"},{status:404});
  return NextResponse.json(report,{headers:{"Cache-Control":"no-store"}});
}

/** Checks current artifacts without a model call, export event or acceptance decision. */
export async function POST(request:NextRequest,{params}:Context) {
  const body=await request.json().catch(()=>null) as {sourceSha256?:unknown;specSha256?:unknown}|null;
  if(typeof body?.sourceSha256!=="string"||!/^[a-f0-9]{64}$/.test(body.sourceSha256)||typeof body.specSha256!=="string"||!/^[a-f0-9]{64}$/.test(body.specSha256))return NextResponse.json({error:"Current source and assembly hashes required"},{status:400});
  const {id}=await params;
  let lease:Awaited<ReturnType<typeof lockAssemblyExport>>|undefined;
  let snapshot:Awaited<ReturnType<NonNullable<typeof lease>["verificationContext"]>>|undefined;
  const startedAt=new Date();
  try {
    lease=await lockAssemblyExport({purpose:"verification",request,jobId:id,sourceSha256:body.sourceSha256,specSha256:body.specSha256});
    snapshot=await lease.verificationContext();
    let manifest:unknown;
    let errorMessage:string|undefined;
    try {
      const prepared=await prepareContractAssembly({scadSource:lease.job.scadSource!,spec:lease.spec,options:{signal:lease.signal},contractSnapshot:{contract:lease.requirements.contract,request:lease.job.inputRequest},contractGate:{evidenceCurrent:lease.requirements.evidenceCurrent,reason:lease.requirements.reason}});
      manifest=prepared.manifest;
    } catch(error) {
      lease.signal.throwIfAborted();
      errorMessage=error instanceof Error?error.message:String(error);
    }
    await lease.verifyUnchanged();
    const saved=await lease.recordVerification({context:snapshot,startedAt,producer:"check",manifest,error:errorMessage});
    const current=await readAssemblyVerification(lease.job,{specSha256:body.specSha256,stale:false},saved.id);
    return NextResponse.json({verification:current.verification,evidence:current.evidence},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if(error instanceof AssemblyExportRejection)return NextResponse.json({error:error.message},{status:error.status});
    if(error instanceof AssemblyVerificationConflict||error instanceof JobExecutionConflict||error instanceof JobExecutionStopped||lease?.signal.aborted)return NextResponse.json({error:"The job, requirements or verification tools changed. Refresh before checking again."},{status:409});
    console.error("Assembly verification failed",error);
    return NextResponse.json({error:"Assembly verification could not be saved"},{status:500});
  } finally {if(lease)await lease.stop();}
}
