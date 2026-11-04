import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { canProcessJobState, JOB_EXECUTION_FIELD } from "@/lib/pipeline/job-execution";
import { validateAssemblySpec } from "@/lib/assembly/assembly-spec";
import { extractEmbeddedAssemblySpec } from "@/lib/assembly/embedded-spec";
import { ASSEMBLY_REVISION_FIELD, ASSEMBLY_REVISION_LIMIT, ASSEMBLY_SPEC_FIELD, assemblyRecordId, assemblyRevisionId, assemblySourceHash, assemblySpecificationHash, readAssemblySpecification } from "@/lib/pipeline/assembly-spec-record";

const evidence = Object.fromEntries(["identity", "geometry", "assembly", "disassembly", "motion", "physical"].map((key) => [key, { status: "NOT_RUN" }]));
type Context = { params: Promise<{ id: string }> };
class SpecRevisionConflict extends Error {}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) }, select: { scadSource: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(await readAssemblySpecification(id, job.scadSource));
  } catch (error) {
    console.error("Error reading assembly specification", error);
    return NextResponse.json({ error: "Failed to read assembly specification" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => null) as { spec?: unknown; sourceSha256?: unknown; expectedSpecSha256?: unknown } | null;
    const parsed = validateAssemblySpec(body?.spec);
    if (!parsed.success || typeof body?.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceSha256) || !(body.expectedSpecSha256 === null || (typeof body.expectedSpecSha256 === "string" && /^[a-f0-9]{64}$/.test(body.expectedSpecSha256)))) return NextResponse.json({ error: "Invalid assembly specification, source hash, or expected specification hash" }, { status: 400 });
    const serialized = JSON.stringify({ spec: parsed.data, sourceSha256: body.sourceSha256 });
    if (Buffer.byteLength(serialized) > 1_000_000) return NextResponse.json({ error: "Assembly specification too large" }, { status: 413 });
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!canProcessJobState(job.state) || assemblySourceHash(job.scadSource) !== body.sourceSha256) return NextResponse.json({ error: "Job or source changed; refresh before saving" }, { status: 409 });
    const saved = await db.$transaction(async (tx) => {
      const claimed = await tx.job.updateMany({
        where: { id, ...jobAccessFilter(access), state: job.state, updatedAt: job.updatedAt, scadSource: job.scadSource, versions: { none: { field: JOB_EXECUTION_FIELD } } },
        data: { updatedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      const previous = await tx.jobVersion.findUnique({ where: { id: assemblyRecordId(id) } });
      let previousHash: string | null = null;
      if (previous) {
        let value: unknown;
        try { value = JSON.parse(previous.newValue ?? ""); } catch { throw new Error("Stored assembly specification is invalid"); }
        const previousSpec = validateAssemblySpec((value as { spec?: unknown } | null)?.spec);
        if (!previousSpec.success) throw new Error("Stored assembly specification is invalid");
        previousHash = assemblySpecificationHash(previousSpec.data);
      } else if (job.scadSource !== null) {
        const embedded = extractEmbeddedAssemblySpec(job.scadSource);
        if (embedded.status === "valid") previousHash = assemblySpecificationHash(embedded.spec);
      }
      if (previousHash !== body.expectedSpecSha256) throw new SpecRevisionConflict();
      await tx.jobVersion.upsert({
        where: { id: assemblyRecordId(id) },
        create: { id: assemblyRecordId(id), jobId: id, field: ASSEMBLY_SPEC_FIELD, newValue: serialized, changedBy: "user" },
        update: { newValue: serialized, createdAt: new Date() },
      });
      // The current declaration is a pointer; the revision rows are the history.
      // Keeping them append-only means a later save can never rewrite what the
      // user previously declared, and pruning is bounded rather than unbounded.
      // Numbering reads the newest retained row: counting rows would repeat a
      // number as soon as pruning removed the oldest one.
      const latestRevision = await tx.jobVersion.findFirst({
        where: { jobId: id, field: ASSEMBLY_REVISION_FIELD },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { newValue: true },
      });
      let nextRevision = 1;
      if (latestRevision) {
        try {
          const value = JSON.parse(latestRevision.newValue ?? "") as { revision?: unknown };
          if (typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0) nextRevision = value.revision + 1;
        } catch { /* An unreadable row must not stop a save; numbering restarts from 1. */ }
      }
      await tx.jobVersion.create({
        data: {
          id: assemblyRevisionId(id), jobId: id, field: ASSEMBLY_REVISION_FIELD, changedBy: "user",
          newValue: JSON.stringify({ revision: nextRevision, spec: parsed.data, sourceSha256: body.sourceSha256, specSha256: assemblySpecificationHash(parsed.data), previousSpecSha256: previousHash, savedAt: new Date().toISOString() }),
        },
      });
      const expired = await tx.jobVersion.findMany({
        where: { jobId: id, field: ASSEMBLY_REVISION_FIELD },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: ASSEMBLY_REVISION_LIMIT,
        select: { id: true },
      });
      if (expired.length > 0) await tx.jobVersion.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });
      return nextRevision;
    });
    if (!saved) return NextResponse.json({ error: "Job changed or is processing; refresh before saving" }, { status: 409 });
    return NextResponse.json({ spec: parsed.data, specSha256: assemblySpecificationHash(parsed.data), sourceSha256: body.sourceSha256, currentSourceSha256: body.sourceSha256, stale: false, provenance: "user", revision: saved, evidence });
  } catch (error) {
    if (error instanceof SpecRevisionConflict) return NextResponse.json({ error: "Assembly specification changed; refresh before saving" }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && String(error.code) === "P2034") return NextResponse.json({ error: "Job changed or is processing; refresh before saving" }, { status: 409 });
    console.error("Error saving assembly specification", error);
    return NextResponse.json({ error: "Failed to save assembly specification" }, { status: 500 });
  }
}
