import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { toPublicJob } from "@/lib/public-job";
import { db } from "@/lib/db";

// Valid job states
const VALID_STATES = [
  "NEW",
  "SCAD_GENERATED",
  "RENDERED",
  "VALIDATED",
  "DELIVERED",
  "DEBUGGING",
  "REPAIRING",
  "VALIDATION_FAILED",
  "GEOMETRY_FAILED",
  "RENDER_FAILED",
  "HUMAN_REVIEW",
  "CANCELLED",
  "DELETING",
] as const;

type JobState = (typeof VALID_STATES)[number];

/**
 * GET /api/jobs
 * List all jobs with optional state filter, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state") as JobState | null;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const includeCount = searchParams.get("count") !== "false";

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100) : 50;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;

    if (state && !VALID_STATES.includes(state)) {
      return NextResponse.json(
        { error: `Invalid state filter. Valid states: ${VALID_STATES.join(", ")}` },
        { status: 400 }
      );
    }

    const summary = searchParams.get("summary") === "true";
    const where: Prisma.JobWhereInput = {
      ...jobAccessFilter(access),
      ...(state ? { state } : {}),
    };

    const take = includeCount ? limit : limit + 1;
    const jobs = summary
      ? await db.job.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take,
          skip: offset,
          select: {
            id: true,
            state: true,
            inputRequest: true,
            customerId: true,
            modelId: true,
            partFamily: true,
            builderName: true,
            stlPath: true,
            pngPath: true,
            reportPath: true,
            qualityScore: true,
            validationReportJson: true,
            parentId: true,
            retryCount: true,
            maxRetries: true,
            createdAt: true,
            updatedAt: true,
            completedAt: true,
          },
        })
      : await db.job.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take,
        skip: offset,
        include: {
          parent: { select: { id: true, inputRequest: true, state: true, partFamily: true } },
          children: { select: { id: true, inputRequest: true, state: true, partFamily: true } },
        },
      });

    const hasExtraJob = !includeCount && jobs.length > limit;
    const pageJobs = hasExtraJob ? jobs.slice(0, limit) : jobs;
    const total = includeCount ? await db.job.count({ where }) : offset + pageJobs.length + (hasExtraJob ? 1 : 0);

    return NextResponse.json({
      jobs: pageJobs.map(toPublicJob),
      total,
      pagination: {
        total,
        limit,
        offset,
        hasMore: includeCount ? offset + limit < total : hasExtraJob,
      },
    });
  } catch (error) {
    console.error("Error listing jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs
 * Create a new job with inputRequest, customerId, modelId
 */
export async function POST(request: NextRequest) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }

    const body = await request.json();
    const { inputRequest, customerId, modelId } = body;

    if (!inputRequest || typeof inputRequest !== "string" || inputRequest.trim().length === 0) {
      return NextResponse.json(
        { error: "inputRequest is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    const selectedModelId =
      typeof modelId === "string" && modelId.trim().length > 0
        ? modelId.trim()
        : process.env.MIMO_MODEL || "mimo-v2.5-pro";

    const job = await db.job.create({
      data: {
        browserSessionId:
          access.kind === "browser" ? access.browserSessionId : null,
        inputRequest: inputRequest.trim(),
        customerId: customerId || null,
        modelId: selectedModelId,
        state: "NEW",
        executionLogs: JSON.stringify([
          {
            timestamp: new Date().toISOString(),
            event: "JOB_CREATED",
            message: `Job created with input: ${inputRequest.trim().substring(0, 100)} (model: ${selectedModelId})`,
          },
        ]),
      },
    });

    return NextResponse.json({ job: toPublicJob(job) }, { status: 201 });
  } catch (error) {
    console.error("Error creating job:", error);
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }
}
