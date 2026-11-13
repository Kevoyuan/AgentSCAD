import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { readAssemblySpecification } from "@/lib/pipeline/assembly-spec-record";
import { readRequirementContract } from "@/lib/requirements/requirement-contract-record";
import { AssemblyIdentityError, buildAssemblyBundle } from "@/lib/assembly/assembly-bundle";
import { summarizeAssemblyEvidence } from "@/lib/assembly/assembly-evidence-report";
import {
  ASSEMBLY_EVIDENCE_CHECKER_VERSION,
  appendEvidenceSnapshot, createEvidenceSnapshot, fingerprintRequirementState, InvalidEvidenceCursor,
  readEvidenceSnapshots,
} from "@/lib/assembly/evidence-snapshot-record";
import { AssemblyExportRejection, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const SHA = /^[0-9a-f]{64}$/;

/** Read only bounded saved history; never rerender implicitly or reuse an old PASS. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) }, select: { scadSource: true, inputRequest: true, state: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const current = await readAssemblySpecification(id, job.scadSource);
    const requirements = await readRequirementContract(id, job.inputRequest);
    const search = new URL(request.url).searchParams;
    const requestedLimit = Number(search.get("limit") ?? "10");
    const beforeId = search.get("cursor") ?? undefined;
    if (beforeId && beforeId.length > 200) return NextResponse.json({ error: "Invalid evidence history cursor" }, { status: 400 });
    const page = await readEvidenceSnapshots(id, {
      sourceSha256: current.currentSourceSha256,
      specificationSha256: current.specSha256,
      requirementFingerprint: fingerprintRequirementState(requirements),
      checkerVersion: ASSEMBLY_EVIDENCE_CHECKER_VERSION,
      isDelivered: job.state === "DELIVERED",
    }, requestedLimit, beforeId);
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidEvidenceCursor) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Error reading assembly evidence history", error);
    return NextResponse.json({ error: "Assembly evidence history could not be read" }, { status: 500 });
  }
}

/**
 * An explicit request re-measures server-side and appends a *new immutable*
 * historical row. Never accept a client-submitted PASS/report. The same
 * export lease prevents edits to code, spec or requirements during rendering.
 */
export async function POST(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const sourceSha256 = query.get("sourceSha256");
  const specSha256 = query.get("specSha256");
  if (!sourceSha256 || !SHA.test(sourceSha256) || !specSha256 || !SHA.test(specSha256)) {
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
    const snapshot = createEvidenceSnapshot(summarizeAssemblyEvidence(bundle), lease.requirements);
    await lease.verifyUnchanged();
    const saved = await appendEvidenceSnapshot(id, snapshot);
    // A concurrent edit after the write can only make the appended record
    // historical. Never claim the row is current on a failed final check.
    await lease.verifyUnchanged();
    return NextResponse.json({
      id: saved.id,
      savedAt: saved.createdAt.toISOString(),
      integrity: "PASS",
      bindingCurrent: true,
      snapshot,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssemblyExportRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    console.error("Error recording assembly evidence snapshot", error);
    return NextResponse.json({ error: "Assembly evidence snapshot could not be recorded" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
