import { createHash, randomUUID } from "crypto";
import { db } from "@/lib/db";
import { extractEmbeddedAssemblySpec } from "@/lib/assembly/embedded-spec";
import { validateAssemblySpec } from "@/lib/assembly/assembly-spec";
import { assemblySpecificationHash } from "@/lib/assembly/spec-hash";
export { assemblySpecificationHash } from "@/lib/assembly/spec-hash";

export const ASSEMBLY_SPEC_FIELD = "__assembly_spec";
/** Append-only history rows; never the current declaration. */
export const ASSEMBLY_REVISION_FIELD = "__assembly_spec_revision";
export const ASSEMBLY_REVISION_LIMIT = 20;
const REVISION_PAYLOAD_BUDGET = 2 * 1024 * 1024;

export const assemblyRecordId = (jobId: string) => `assembly-spec:${jobId}`;
export const assemblyRevisionId = (jobId: string) => `assembly-spec-rev:${jobId}:${randomUUID()}`;
export const assemblySourceHash = (source: string | null) => source === null ? null : createHash("sha256").update(source).digest("hex");
const evidence = Object.fromEntries(["identity", "geometry", "assembly", "disassembly", "motion", "physical"].map((key) => [key, { status: "NOT_RUN" }]));

/** Caller must perform session authorization before reading this job's snapshot. */
export async function readAssemblySpecification(jobId: string, source: string | null) {
  const row = await db.jobVersion.findUnique({ where: { id: assemblyRecordId(jobId) } });
  const currentSourceSha256 = assemblySourceHash(source);
  if (!row) {
    const embedded = source === null ? { status: "absent" as const } : extractEmbeddedAssemblySpec(source);
    if (embedded.status === "valid") return { spec: embedded.spec, specSha256: assemblySpecificationHash(embedded.spec), sourceSha256: currentSourceSha256, currentSourceSha256, stale: false, provenance: "generated" as const, embeddedStatus: "valid", evidence };
    return { spec: null, specSha256: null, sourceSha256: null, currentSourceSha256, stale: false, provenance: null, embeddedStatus: embedded.status, ...(embedded.status === "invalid" ? { embeddedError: embedded.reason } : {}), evidence };
  }
  let stored: { spec?: unknown; sourceSha256?: unknown };
  try { stored = JSON.parse(row.newValue ?? ""); } catch { throw new Error("Stored assembly specification is invalid"); }
  const parsed = validateAssemblySpec(stored.spec);
  if (!parsed.success || typeof stored.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(stored.sourceSha256)) throw new Error("Stored assembly specification is invalid");
  return { spec: parsed.data, specSha256: assemblySpecificationHash(parsed.data), sourceSha256: stored.sourceSha256, currentSourceSha256, stale: currentSourceSha256 !== stored.sourceSha256, provenance: "user" as const, evidence };
}

export interface AssemblyRevision {
  id: string;
  revision: number | null;
  savedAt: string;
  sourceSha256: string | null;
  specSha256: string;
  stale: boolean;
  spec: unknown;
}

/**
 * Saved declarations, newest first. Rows are append-only so a later edit can
 * never rewrite what the user previously declared; malformed rows are skipped
 * rather than reported as valid history.
 */
export async function readAssemblyRevisions(jobId: string, currentSourceSha256: string | null, limit = ASSEMBLY_REVISION_LIMIT): Promise<AssemblyRevision[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || ASSEMBLY_REVISION_LIMIT, 1), ASSEMBLY_REVISION_LIMIT);
  const rows = await db.jobVersion.findMany({
    where: { jobId, field: ASSEMBLY_REVISION_FIELD },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  const revisions: AssemblyRevision[] = [];
  let budget = REVISION_PAYLOAD_BUDGET;
  for (const row of rows) {
    let value: { revision?: unknown; spec?: unknown; sourceSha256?: unknown };
    try { value = JSON.parse(row.newValue ?? ""); } catch { continue; }
    const parsed = validateAssemblySpec(value?.spec);
    if (!parsed.success) continue;
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > budget) break;
    budget -= serialized.length;
    revisions.push({
      id: row.id,
      revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0 ? value.revision : null,
      savedAt: row.createdAt.toISOString(),
      sourceSha256: typeof value.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.sourceSha256) ? value.sourceSha256 : null,
      specSha256: assemblySpecificationHash(parsed.data),
      stale: currentSourceSha256 !== null && value.sourceSha256 !== currentSourceSha256,
      spec: parsed.data,
    });
  }
  return revisions;
}
