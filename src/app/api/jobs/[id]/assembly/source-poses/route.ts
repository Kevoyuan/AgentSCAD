import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonical-json";
import { observeSourcePoses } from "@/lib/assembly/source-pose-observer";
import { runSourcePoseWithinBudget, SourcePoseDeadlineExceeded, SourcePoseLeaseAborted } from "@/lib/assembly/source-pose-budget";
import { bindSourcePoseJobRequest, InvalidSourcePoseJobRequest } from "@/lib/assembly/source-pose-job-request";
import { AssemblyIdentityError } from "@/lib/assembly/assembly-bundle";
import { AssemblyExportRejection, lockAssemblyExport } from "@/lib/pipeline/assembly-export-guard";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const MAX_REQUEST_BYTES = 4096;

/** Read at most 4 KiB, including when Content-Length is missing or misleading. */
async function boundedBody(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_REQUEST_BYTES) {
    throw new InvalidSourcePoseJobRequest("Source-pose request exceeds the 4 KiB limit.");
  }
  if (!request.body) throw new InvalidSourcePoseJobRequest("JSON request body required.");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new InvalidSourcePoseJobRequest("Source-pose request exceeds the 4 KiB limit.");
      }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { throw new InvalidSourcePoseJobRequest("A valid UTF-8 JSON request is required."); }
  } finally { reader.releaseLock(); }
}

/**
 * Explicit read-only source/pose observation.
 * - session + source/spec/requirements are protected by the existing export lease
 * - raw source parameter binding is user-confirmed, not independently semantic
 * - all world poses are GENERATED SERVER-SIDE from the declared grounded joint
 * - no background evaluation, JobOutcome, export record, or acceptance writes
 * - the measured PASS does NOT promote product motion or physical validation
 */
export async function POST(request: NextRequest, { params }: Context) {
  const { id } = await params;
  let lease: Awaited<ReturnType<typeof lockAssemblyExport>> | undefined;
  try {
    const raw = await boundedBody(request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidSourcePoseJobRequest("Expected an object describing a confirmed source-parameter binding.");
    }
    const fields = raw as Record<string, unknown>;
    if (typeof fields.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(fields.sourceSha256) ||
        typeof fields.specSha256 !== "string" || !/^[a-f0-9]{64}$/.test(fields.specSha256)) {
      throw new InvalidSourcePoseJobRequest("Current source and specification hashes are required.");
    }
    lease = await lockAssemblyExport({
      request, jobId: id, sourceSha256: fields.sourceSha256, specSha256: fields.specSha256,
    });
    const source = lease.job.scadSource;
    if (!source) throw new AssemblyExportRejection(409, "Job has no delivered CAD source.");
    const { binding } = bindSourcePoseJobRequest({ raw, spec: lease.spec, scadSource: source });
    const report = await runSourcePoseWithinBudget(lease.signal, async (signal) => {
      const measured = await observeSourcePoses({
        scadSource: source, spec: lease!.spec,
        referenceSelector: "all", samples: binding.samples,
        analyticSweep: {
          movingInstanceId: binding.movingInstanceId,
          axis: binding.axis,
          anglesDeg: binding.samples.map(sample => sample.parameters[binding.sourceParameter]),
        },
        // Narrowed after the strict SHA validation above; these are immutable
        // string values even across the asynchronous observer callback.
        expectedSourceSha256: fields.sourceSha256 as string,
        expectedSpecificationSha256: fields.specSha256 as string,
        options: { signal },
      });
      // The final source/spec/requirements check is part of the same deadline,
      // and a late result cannot be elevated to a completed observation.
      await lease!.verifyUnchanged();
      return measured;
    });
    const bindingSha256 = createHash("sha256").update(canonicalJson({
      sourceSha256: fields.sourceSha256,
      specSha256: fields.specSha256,
      contractSha256: lease.requirements.contractSha256,
      connectionId: binding.connectionId,
      sourceParameter: binding.sourceParameter,
      movingInstanceId: binding.movingInstanceId,
      rotationDeg: binding.rotationDeg,
      sampleCount: binding.sampleCount,
      samples: binding.samples,
    })).digest("hex");
    return NextResponse.json({
      schemaVersion: 1,
      sourceSha256: fields.sourceSha256, specSha256: fields.specSha256,
      contractSha256: lease.requirements.contractSha256,
      confirmedRequirementCurrent: lease.requirements.evidenceCurrent,
      bindingSha256,
      binding: {
        connectionId: binding.connectionId,
        sourceParameter: binding.sourceParameter,
        movingInstanceId: binding.movingInstanceId,
        groundedInstanceId: binding.groundedInstanceId,
        rotationDeg: binding.rotationDeg,
        sampleCount: binding.sampleCount,
        maximumSampleAngleGapDeg: binding.maximumSampleAngleGapDeg,
        axis: binding.axis,
        userConfirmed: true,
        independentParameterSemanticsVerified: false,
      },
      report,
      productMotionApproval: "NOT_RUN",
      physicalFunctionApproval: "NOT_RUN",
      limitations: "Only 3–9 independent source-pose surface observations. The optional interval checker certifies or rejects only analytic declared rigid-part motion, not the actual source-variable behavior between rendered frames. The selected source parameter is not independently linked to intended mechanism semantics. Product motion, forces, physical fit and manufacturing approval remain NOT_RUN.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidSourcePoseJobRequest) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes("4 KiB") ? 413 : 422 });
    }
    if (error instanceof AssemblyExportRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) {
      return NextResponse.json({ error: "Job changed or is processing" }, { status: 409 });
    }
    if (error instanceof AssemblyIdentityError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof SourcePoseLeaseAborted) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SourcePoseDeadlineExceeded) return NextResponse.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
    console.error("Could not independently inspect source poses", error);
    return NextResponse.json({ error: "Source-pose inspection failed; no motion approval was recorded" }, { status: 500 });
  } finally {
    if (lease) await lease.stop();
  }
}
