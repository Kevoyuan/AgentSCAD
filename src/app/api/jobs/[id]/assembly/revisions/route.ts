import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { assemblySourceHash, readAssemblyRevisions } from "@/lib/pipeline/assembly-spec-record";

type Context = { params: Promise<{ id: string }> };

/** Saved declarations, newest first. History is read-only; saving always creates a new revision. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) }, select: { scadSource: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ revisions: await readAssemblyRevisions(id, assemblySourceHash(job.scadSource)) });
  } catch (error) {
    console.error("Error reading assembly revisions", error);
    return NextResponse.json({ error: "Failed to read assembly revisions" }, { status: 500 });
  }
}
