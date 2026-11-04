import { NextRequest, NextResponse } from "next/server";
import { AssemblyExportRejection, artifactVersionForSource, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";
import { renderAssemblyParts } from "@/lib/tools/assembly-part-renderer";
import { recordJobOutcomeSafe } from "@/lib/outcome/job-outcome";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string; partId: string }> };

/** Returns one source-selected candidate, without claiming that its identity or fit has been verified. */
export async function GET(request: NextRequest, { params }: Context) {
  const { id, partId } = await params;
  const sourceSha256 = new URL(request.url).searchParams.get("sourceSha256");
  const specSha256 = new URL(request.url).searchParams.get("specSha256");
  if (!sourceSha256 || !/^[a-f0-9]{64}$/.test(sourceSha256) || !specSha256 || !/^[a-f0-9]{64}$/.test(specSha256) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(partId)) return NextResponse.json({ error: "Valid source hash, specification hash and part ID required" }, { status: 400 });
  let lease: Awaited<ReturnType<typeof lockAssemblyExport>> | undefined;
  try {
    lease = await lockAssemblyExport({ request, jobId: id, sourceSha256, specSha256 });
    const source = lease.job.scadSource;
    if (!source) throw new AssemblyExportRejection(409, "Job is not in a delivered state");
    const part = lease.spec.parts.find((item) => item.id === partId);
    if (!part || part.source !== "generated") return NextResponse.json({ error: "Generated part not found" }, { status: 404 });
    const [rendered] = await renderAssemblyParts({ scadSource: source, parts: [{ partId: part.id, selector: part.selector }], options: { signal: lease.signal } });
    await lease.verifyUnchanged();
    if (new URL(request.url).searchParams.get("download") === "1") {
      try {
        const artifactVersionId = await artifactVersionForSource(id, sourceSha256);
        await recordJobOutcomeSafe({ jobId: id, kind: "exported", source: "user", artifactVersionId, detail: { artifact: "assembly_part", partId, sourceSha256, specSha256, partSha256: rendered.sha256,
          contractSha256: lease.requirements.contractSha256, contractRevision: lease.requirements.contract.revision,
          requestSha256: lease.requirements.contract.requestSha256, contractCurrent: lease.requirements.evidenceCurrent,
        } });
      } catch (error) { console.warn("Could not record assembly part export", error); }
    }
    return new Response(new Uint8Array(rendered.stl), { headers: {
      "Content-Type": "model/stl", "Content-Disposition": `attachment; filename="${partId}.stl"`, "Content-Length": String(rendered.stl.length),
      "Cache-Control": "no-store", "X-AgentSCAD-Source-SHA256": sourceSha256,
      "X-AgentSCAD-Spec-SHA256": specSha256,
      "X-AgentSCAD-Contract-SHA256": lease.requirements.contractSha256,
      "X-AgentSCAD-Contract-Current": String(lease.requirements.evidenceCurrent),
      "X-AgentSCAD-Part-SHA256": rendered.sha256, "X-AgentSCAD-Verification": "identity,assembly,motion,physical=NOT_RUN",
    } });
  } catch (error) {
    if (error instanceof AssemblyExportRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    console.error("Error rendering assembly part", error);
    return NextResponse.json({ error: "Part rendering failed" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
