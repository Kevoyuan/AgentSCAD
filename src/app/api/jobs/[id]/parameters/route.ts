import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { toPublicJob } from "@/lib/public-job";
import { updateJobParameters, ParameterValidationError } from "@/lib/pipeline/update-job-parameters";
import { JobExecutionConflict, JobExecutionStopped } from "@/lib/pipeline/job-execution";

export const maxDuration = 300;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const parameters = body.parameters ?? body.parameterValues;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
      return NextResponse.json({ error: "parameters must be an object with key-value pairs" }, { status: 400 });
    }
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const result = await updateJobParameters(job, parameters);
    return NextResponse.json({ ...result, job: toPublicJob(result.job), updatedParameters: Object.keys(parameters) });
  } catch (error) {
    if (error instanceof ParameterValidationError) {
      return NextResponse.json({ error: error.message, validationErrors: error.validationErrors }, { status: 422 });
    }
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error updating parameters:", error);
    return NextResponse.json({ error: "Failed to update and render parameters", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
