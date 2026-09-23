import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { latestArtifactVersionId } from "@/lib/artifacts/artifact-version";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import {
  JOB_OUTCOME_KINDS,
  JOB_OUTCOME_MAX_LIMIT,
  clampOutcomeLimit,
  isJobOutcomeKind,
  listJobOutcomes,
  recordJobOutcome,
  JobOutcomeValidationError,
  summarizeJobOutcomes,
} from "@/lib/outcome/job-outcome";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/outcome
 *
 * The outcome ledger for one job plus its summary. `DELIVERED` is not part of this
 * payload on purpose: pipeline state and outcome evidence are separate facts.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const { id } = await params;

    const job = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
      select: { id: true },
    });
    if (!job) {
      return NextResponse.json({ error: `Job not found with id: ${id}` }, { status: 404 });
    }

    const limitParam = new URL(request.url).searchParams.get("limit");
    const outcomes = await listJobOutcomes(
      id,
      limitParam === null ? undefined : clampOutcomeLimit(limitParam),
    );

    return NextResponse.json({
      outcomes,
      summary: summarizeJobOutcomes(outcomes, await latestArtifactVersionId(id)),
    });
  } catch (error) {
    console.error("List job outcomes error:", error);
    return NextResponse.json({ error: "Failed to list job outcomes" }, { status: 500 });
  }
}

/**
 * POST /api/jobs/[id]/outcome
 *
 * Record an explicit user decision or an edit/export that the UI could not infer.
 * Body: `{ "kind": "accepted" | "rejected" | "user_edited" | "exported", "detail"?: unknown }`
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const { id } = await params;

    const job = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
      select: { id: true },
    });
    if (!job) {
      return NextResponse.json({ error: `Job not found with id: ${id}` }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const kind = (body as { kind?: unknown } | null)?.kind;
    if (!isJobOutcomeKind(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${JOB_OUTCOME_KINDS.join(", ")}` },
        { status: 400 },
      );
    }

    const outcome = await recordJobOutcome({
      jobId: id,
      kind,
      source: "user",
      detail: (body as { detail?: unknown }).detail ?? null,
    });

    const outcomes = await listJobOutcomes(id, JOB_OUTCOME_MAX_LIMIT);

    return NextResponse.json(
      { outcome, outcomes, summary: summarizeJobOutcomes(outcomes, await latestArtifactVersionId(id)) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof JobOutcomeValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Record job outcome error:", error);
    return NextResponse.json({ error: "Failed to record job outcome" }, { status: 500 });
  }
}
