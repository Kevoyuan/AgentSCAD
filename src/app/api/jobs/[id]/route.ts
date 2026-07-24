import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { deleteJobArtifacts } from "@/lib/tools/artifact-store";
import { toPublicJob } from "@/lib/public-job";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]
 * Get a single job by ID
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
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
      return NextResponse.json(
        { error: `Job not found with id: ${id}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ job: toPublicJob(job) });
  } catch (error) {
    console.error("Error fetching job:", error);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs/[id]
 * Delete a job by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const { id } = await params;

    const existingJob = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
    });

    if (!existingJob) {
      return NextResponse.json(
        { error: `Job not found with id: ${id}` },
        { status: 404 }
      );
    }

    await db.job.update({
      where: { id },
      data: {
        state: "DELETING",
        notes: existingJob.notes
          ? `${existingJob.notes}\nJob deletion requested`
          : "Job deletion requested",
      },
    });

    try {
      await deleteJobArtifacts(id);
    } catch (artifactError) {
      console.error(`Failed to clean artifacts for deleted job ${id}:`, artifactError);
      return NextResponse.json(
        {
          error: "Artifact cleanup failed; deletion can be retried safely",
          id,
        },
        { status: 503 }
      );
    }

    await db.job.delete({
      where: { id },
    });

    return NextResponse.json({
      message: `Job ${id} deleted successfully`,
      id,
    });
  } catch (error) {
    console.error("Error deleting job:", error);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
