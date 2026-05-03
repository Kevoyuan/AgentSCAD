import { NextRequest, NextResponse } from "next/server";
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
] as const;

type JobState = (typeof VALID_STATES)[number];

/**
 * GET /api/jobs
 * List all jobs with optional state filter, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
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
    const where = state ? { state } : {};

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
      jobs: pageJobs,
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

    // Generate a neutral default parameter schema. The processing pipeline owns
    // part-family detection; new generic jobs should not look like enclosures.
    const defaultParameterSchema = JSON.stringify({
      part_family: "unknown",
      design_summary: "Custom part based on user request",
      parameters: [
        {
          key: "width",
          label: "Width",
          kind: "number",
          unit: "mm",
          value: 40,
          min: 10,
          max: 200,
          step: 1,
          source: "user",
          editable: true,
          description: "Outer width",
          group: "dimensions",
        },
        {
          key: "depth",
          label: "Depth",
          kind: "number",
          unit: "mm",
          value: 30,
          min: 10,
          max: 200,
          step: 1,
          source: "user",
          editable: true,
          description: "Outer depth",
          group: "dimensions",
        },
        {
          key: "height",
          label: "Height",
          kind: "number",
          unit: "mm",
          value: 15,
          min: 5,
          max: 100,
          step: 1,
          source: "inferred",
          editable: true,
          description: "Outer height",
          group: "dimensions",
        },
        {
          key: "wall_thickness",
          label: "Wall Thickness",
          kind: "number",
          unit: "mm",
          value: 2.0,
          min: 1.2,
          max: 5,
          step: 0.1,
          source: "design_derived",
          editable: true,
          description: "Wall thickness",
          group: "fit",
        },
      ],
    });

    // Default parameter values derived from the schema
    const defaultParameterValues = JSON.stringify({
      width: 40,
      depth: 30,
      height: 15,
      wall_thickness: 2.0,
    });

    const job = await db.job.create({
      data: {
        inputRequest: inputRequest.trim(),
        customerId: customerId || null,
        modelId: selectedModelId,
        state: "NEW",
        parameterSchema: defaultParameterSchema,
        parameterValues: defaultParameterValues,
        executionLogs: JSON.stringify([
          {
            timestamp: new Date().toISOString(),
            event: "JOB_CREATED",
            message: `Job created with input: ${inputRequest.trim().substring(0, 100)} (model: ${selectedModelId})`,
          },
        ]),
      },
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error("Error creating job:", error);
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }
}
