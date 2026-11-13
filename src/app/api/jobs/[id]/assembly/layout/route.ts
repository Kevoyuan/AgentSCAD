import { NextRequest, NextResponse } from "next/server";
import { AssemblyIdentityError, buildAssemblyBundle } from "@/lib/assembly/assembly-bundle";
import { AssemblyReconstructionError, reconstructAssemblyBundle } from "@/lib/assembly/reconstruct-assembly-bundle";
import { AssemblyExportRejection, artifactVersionForSource, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";
import { recordJobOutcomeSafe } from "@/lib/outcome/job-outcome";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

/**
 * A placed layout STL for a complete, generated assembly. It is deliberately
 * not called a verified/printable assembly: no Boolean union, joint evidence,
 * reference pose comparison, or physical validation happens here.
 *
 * The same lease and current-source/spec checks as the ZIP and part exporters
 * prevent unauthorized or stale geometry from being downloaded.
 */
export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const sourceSha256 = query.get("sourceSha256");
  const specSha256 = query.get("specSha256");
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
      return NextResponse.json({ error: "This assembly declares no generated parts to export" }, { status: 422 });
    }
    if (lease.spec.instances.some(instance => lease!.spec.parts.some(part =>
      part.id === instance.partId && part.source === "purchased"))) {
      return NextResponse.json({
        error: "Complete assembly layout requires geometry for purchased parts. Download the parts ZIP instead.",
      }, { status: 422 });
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
    lease.signal.throwIfAborted();
    const { stl, report } = reconstructAssemblyBundle({ zip: bundle.zip });
    await lease.verifyUnchanged();

    if (query.get("download") === "1") {
      try {
        const artifactVersionId = await artifactVersionForSource(id, sourceSha256);
        await recordJobOutcomeSafe({
          jobId: id,
          kind: "exported",
          source: "user",
          artifactVersionId,
          detail: {
            artifact: "assembly_layout",
            sourceSha256,
            specSha256,
            bundleSha256: bundle.sha256,
            layoutSha256: report.assembledStlSha256,
            instanceCount: report.instances.length,
            triangleCount: report.triangleCount,
            referenceStatus: report.reference.status,
            contract: bundle.manifest.contract,
          },
        });
      } catch (error) {
        console.warn("Could not record assembly layout export", error);
      }
    }
    return new Response(new Uint8Array(stl), {
      headers: {
        "Content-Type": "model/stl",
        "Content-Disposition": 'attachment; filename="agentscad-layout-' + id + '.stl"',
        "Content-Length": String(stl.length),
        "Cache-Control": "no-store",
        "X-AgentSCAD-Source-SHA256": sourceSha256,
        "X-AgentSCAD-Spec-SHA256": specSha256,
        "X-AgentSCAD-Bundle-SHA256": bundle.sha256,
        "X-AgentSCAD-Layout-SHA256": report.assembledStlSha256,
        "X-AgentSCAD-Layout-Status": report.reconstruction,
        "X-AgentSCAD-Reference-Status": report.reference.status,
        "X-AgentSCAD-Instance-Count": String(report.instances.length),
        "X-AgentSCAD-Contract-Current": String(bundle.manifest.contract.evidenceCurrent),
        "X-AgentSCAD-Verification": "layout=NOT_RUN,reference=NOT_RUN,physical=NOT_RUN",
      },
    });
  } catch (error) {
    if (error instanceof AssemblyExportRejection) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) {
      return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    }
    if (error instanceof AssemblyReconstructionError) {
      if (error.code === "PURCHASED_PARTS_UNAVAILABLE" || error.code === "NO_GEOMETRY") {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }
      if (error.code === "TRIANGLE_BUDGET") {
        return NextResponse.json({ error: "Assembly layout exceeds the 1,000,000 triangle reconstruction limit" }, { status: 422 });
      }
    }
    console.error("Error reconstructing assembly layout", error);
    return NextResponse.json({ error: "Assembly layout export failed" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
