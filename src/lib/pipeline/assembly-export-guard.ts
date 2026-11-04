import type { Job } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { claimAssemblyExport } from "./assembly-export-lock";
import { JobExecutionConflict, JobExecutionStopped } from "./job-execution";
import { readAssemblySpecification } from "./assembly-spec-record";
import type { AssemblySpec } from "@/lib/assembly/assembly-spec";
import { readRequirementContract, type RequirementContractRecord } from "@/lib/requirements/requirement-contract-record";

/**
 * An export is refused for a reason the user can act on. `status` is the HTTP
 * answer; anything thrown by rendering stays a 500 because it is our failure.
 */
export class AssemblyExportRejection extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AssemblyExportRejection";
  }
}

export interface AssemblyExportLease {
  job: Job;
  spec: AssemblySpec;
  /** Read from the server under the export lease, never from client assertions. */
  requirements: RequirementContractRecord;
  /** Aborts when the client disconnects or the lease is lost. */
  signal: AbortSignal;
  /** Re-checks the job and the declaration after rendering, under the same lease. */
  verifyUnchanged(): Promise<void>;
  /** Clears the heartbeat and releases the execution mutex. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * One guard for every part export path: session scope, delivered state, the
 * execution mutex, and source/spec hashes rechecked after rendering. Duplicating
 * this in a second route is how one path quietly loses a check.
 */
export async function lockAssemblyExport(input: {
  request: NextRequest;
  jobId: string;
  sourceSha256: string;
  specSha256: string;
}): Promise<AssemblyExportLease> {
  const access = await getJobAccessScope(input.request);
  if (!access) throw new AssemblyExportRejection(401, "Browser session required");
  const job = await db.job.findFirst({ where: { id: input.jobId, ...jobAccessFilter(access) } });
  if (!job) throw new AssemblyExportRejection(404, "Job not found");
  if (!job.scadSource || job.state !== "DELIVERED") throw new AssemblyExportRejection(409, "Job is not in a delivered state");

  const lease = await claimAssemblyExport(job);
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeatFailed = false;
  let heartbeatRunning = false;
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  input.request.signal.addEventListener("abort", onAbort, { once: true });

  const stop = async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    input.request.signal.removeEventListener("abort", onAbort);
    await lease.release().catch((error) => console.error("Failed to release assembly export lock", error));
  };

  try {
    const current = await readAssemblySpecification(input.jobId, job.scadSource);
    if (!current.spec || current.stale || current.sourceSha256 !== input.sourceSha256 || current.specSha256 !== input.specSha256) {
      throw new AssemblyExportRejection(409, "Assembly specification or source changed; refresh before downloading");
    }
    const requirements = await readRequirementContract(input.jobId, job.inputRequest);
    const requirementVersion = (record: RequirementContractRecord) => JSON.stringify([
      record.contractSha256, record.confirmedContractSha256, record.revision,
      record.confirmedAt, record.evidenceCurrent, record.stale,
    ]);
    const capturedRequirementVersion = requirementVersion(requirements);
    timer = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      lease.heartbeat().catch(() => { heartbeatFailed = true; abort.abort(); }).finally(() => { heartbeatRunning = false; });
    }, 30_000);
    if (input.request.signal.aborted) abort.abort();

    return {
      job,
      spec: current.spec,
      requirements,
      signal: abort.signal,
      async verifyUnchanged() {
        if (heartbeatFailed || abort.signal.aborted) throw new JobExecutionStopped();
        await lease.heartbeat();
        const latest = await db.job.findFirst({ where: { id: input.jobId, ...jobAccessFilter(access) } });
        if (!latest || latest.scadSource !== job.scadSource || latest.state !== job.state || latest.inputRequest !== job.inputRequest) {
          throw new AssemblyExportRejection(409, "Job changed while rendering");
        }
        const after = await readAssemblySpecification(input.jobId, latest.scadSource);
        if (after.stale || after.sourceSha256 !== input.sourceSha256 || after.specSha256 !== input.specSha256) {
          throw new AssemblyExportRejection(409, "Assembly specification changed while rendering");
        }
        const afterRequirements = await readRequirementContract(input.jobId, latest.inputRequest);
        if (requirementVersion(afterRequirements) !== capturedRequirementVersion) {
          throw new AssemblyExportRejection(409, "Requirement contract changed while rendering");
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The artifact version that was built from exactly this source, if one exists. */
export async function artifactVersionForSource(jobId: string, sourceSha256: string): Promise<string | null> {
  // A job can have older artifact versions after a source edit. Never bind an
  // export to a version containing different source.
  const artifact = await db.jobArtifactVersion.findFirst({
    where: { jobId, scadHash: sourceSha256 },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return artifact?.id ?? null;
}

export { JobExecutionConflict, JobExecutionStopped };
