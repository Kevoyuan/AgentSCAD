import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { approvePersistedCadRequestInterpretation } from "@/lib/intake/request-approval";
import { toPublicJob } from "@/lib/public-job";
import { appendLog } from "@/lib/stores/job-store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/intent
 * Resolve a deterministic intake ambiguity without changing the user's original request.
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
    });
    if (!job) {
      return NextResponse.json({ error: `Job not found with id: ${id}` }, { status: 404 });
    }
    if (job.state !== "HUMAN_REVIEW" || job.generationPath !== "intent_clarification") {
      return NextResponse.json(
        { error: "This job is not waiting for intent clarification" },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const selectedInterpretationId = body?.selectedInterpretationId;
    if (typeof selectedInterpretationId !== "string" || !selectedInterpretationId.trim()) {
      return NextResponse.json(
        { error: "selectedInterpretationId is required" },
        { status: 400 },
      );
    }

    let approvedIntent;
    try {
      approvedIntent = approvePersistedCadRequestInterpretation(
        job.inputRequest,
        job.intentResult,
        selectedInterpretationId.trim(),
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid interpretation" },
        { status: 400 },
      );
    }

    const selected = approvedIntent.interpretations[0];
    const transition = await db.job.updateMany({
      where: {
        id,
        ...jobAccessFilter(access),
        state: "HUMAN_REVIEW",
        generationPath: "intent_clarification",
      },
      data: {
        state: "NEW",
        generationPath: "intent_approved",
        intentResult: JSON.stringify(approvedIntent),
        cadIntentJson: JSON.stringify({ request_intelligence: approvedIntent }),
        completedAt: null,
        executionLogs: appendLog(
          job.executionLogs,
          "INTENT_APPROVED",
          `User approved interpretation: ${selected.label} (${selected.id})`,
        ),
      },
    });

    if (transition.count !== 1) {
      return NextResponse.json(
        { error: "This clarification was already resolved or the job state changed" },
        { status: 409 },
      );
    }

    const updated = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
    });
    if (!updated) {
      return NextResponse.json({ error: `Job not found with id: ${id}` }, { status: 404 });
    }

    return NextResponse.json({ job: toPublicJob(updated) });
  } catch (error) {
    console.error("Error resolving job intent:", error);
    return NextResponse.json({ error: "Failed to resolve job intent" }, { status: 500 });
  }
}
