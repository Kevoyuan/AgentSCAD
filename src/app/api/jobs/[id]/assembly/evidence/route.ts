import { NextRequest, NextResponse } from "next/server";
import { AssemblyIdentityError, buildAssemblyBundle } from "@/lib/assembly/assembly-bundle";
import { summarizeAssemblyEvidence } from "@/lib/assembly/assembly-evidence-report";
import { AssemblyExportRejection, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

/**
 * Explicit, read-only and on-demand. Reuses the same locked, version-bound
 * production part render as the assembly ZIP; no LLM, background execution,
 * confidence promotion, or persisted "accepted" decision.
 *
 * Never call this on ordinary spec GET/polling — the mesh check is expensive.
 */
export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const paramsQuery = new URL(request.url).searchParams;
  const sourceSha256 = paramsQuery.get("sourceSha256");
  const specSha256 = paramsQuery.get("specSha256");
  if (!sourceSha256 || !/^[a-f0-9]{64}$/.test(sourceSha256) ||
    !specSha256 || !/^[a-f0-9]{64}$/.test(specSha256)) {
    return NextResponse.json({ error: "Valid source and specification hashes required" }, { status: 400 });
  }
  let lease: Awaited<ReturnType<typeof lockAssemblyExport>> | undefined;
  try {
    lease = await lockAssemblyExport({ request, jobId: id, sourceSha256, specSha256 });
    const source = lease.job.scadSource;
    if (!source) throw new AssemblyExportRejection(409, "Job is not in a delivered state");
    if (!lease.spec.parts.some(part => part.source === "generated")) {
      return NextResponse.json({ error: "No generated part meshes are available for inspection" }, { status: 422 });
    }
    let bundle: Awaited<ReturnType<typeof buildAssemblyBundle>>;
    try {
      bundle = await buildAssemblyBundle({
        scadSource: source,
        spec: lease.spec,
        options: { signal: lease.signal },
        modifiedAt: lease.job.updatedAt,
        contractSnapshot: { contract: lease.requirements.contract, request: lease.job.inputRequest },
        contractGate: { evidenceCurrent: lease.requirements.evidenceCurrent, reason: lease.requirements.reason },
      });
    } catch (error) {
      if (error instanceof AssemblyIdentityError) {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }
      throw error;
    }
    const report = summarizeAssemblyEvidence(bundle);
    await lease.verifyUnchanged();
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssemblyExportRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) {
      return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    }
    console.error("Error inspecting assembly evidence", error);
    return NextResponse.json({ error: "Assembly evidence inspection failed" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
