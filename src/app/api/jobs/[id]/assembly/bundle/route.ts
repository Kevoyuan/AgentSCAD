import { NextRequest, NextResponse } from "next/server";
import { AssemblyIdentityError, buildAssemblyBundle } from "@/lib/assembly/assembly-bundle";
import { AssemblyExportRejection, artifactVersionForSource, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";
import { recordJobOutcomeSafe } from "@/lib/outcome/job-outcome";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

/**
 * All generated parts plus a manifest, in one archive. The bundle is built in
 * memory and returned only when every part rendered; it is never a partial set.
 */
export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const sourceSha256 = new URL(request.url).searchParams.get("sourceSha256");
  const specSha256 = new URL(request.url).searchParams.get("specSha256");
  if (!sourceSha256 || !/^[a-f0-9]{64}$/.test(sourceSha256) || !specSha256 || !/^[a-f0-9]{64}$/.test(specSha256)) return NextResponse.json({ error: "Valid source and specification hashes required" }, { status: 400 });
  let lease: Awaited<ReturnType<typeof lockAssemblyExport>> | undefined;
  try {
    lease = await lockAssemblyExport({ request, jobId: id, sourceSha256, specSha256 });
    const source = lease.job.scadSource;
    if (!source) throw new AssemblyExportRejection(409, "Job is not in a delivered state");
    if (!lease.spec.parts.some((part) => part.source === "generated")) return NextResponse.json({ error: "This assembly declares no generated parts to export" }, { status: 422 });
    let bundle: Awaited<ReturnType<typeof buildAssemblyBundle>>;
    try {
      bundle = await buildAssemblyBundle({
        scadSource: source, spec: lease.spec, options: { signal: lease.signal }, modifiedAt: lease.job.updatedAt,
        contractSnapshot: { contract: lease.requirements.contract, request: lease.job.inputRequest },
        contractGate: { evidenceCurrent: lease.requirements.evidenceCurrent, reason: lease.requirements.reason },
      });
    } catch (error) {
      if (error instanceof AssemblyIdentityError) return NextResponse.json({ error: error.message }, { status: 422 });
      throw error;
    }
    await lease.verifyUnchanged();
    if (new URL(request.url).searchParams.get("download") === "1") {
      try {
        const artifactVersionId = await artifactVersionForSource(id, sourceSha256);
        await recordJobOutcomeSafe({ jobId: id, kind: "exported", source: "user", artifactVersionId, detail: { artifact: "assembly_bundle", partCount: bundle.parts.length, purchasedPartIds: bundle.purchasedPartIds, sourceSha256, specSha256, bundleSha256: bundle.sha256, contract: bundle.manifest.contract } });
      } catch (error) { console.warn("Could not record assembly bundle export", error); }
    }
    return new Response(new Uint8Array(bundle.zip), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="agentscad-assembly-${id}.zip"`, "Content-Length": String(bundle.zip.length),
      "Cache-Control": "no-store", "X-AgentSCAD-Source-SHA256": sourceSha256,
      "X-AgentSCAD-Spec-SHA256": specSha256, "X-AgentSCAD-Bundle-SHA256": bundle.sha256,
      "X-AgentSCAD-Part-Count": String(bundle.parts.length),
      "X-AgentSCAD-Contract-SHA256": lease.requirements.contractSha256,
      "X-AgentSCAD-Contract-Current": String(bundle.manifest.contract.evidenceCurrent),
      "X-AgentSCAD-Verification": Object.entries(bundle.manifest.evidence).map(([layer, evidence]) => `${layer}=${evidence.status}`).join(","),
    } });
  } catch (error) {
    if (error instanceof AssemblyExportRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    console.error("Error building assembly bundle", error);
    return NextResponse.json({ error: "Assembly bundle export failed" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
