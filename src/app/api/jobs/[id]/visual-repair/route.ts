import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { appendLog } from "@/lib/stores/job-store";
import {
  runVisualAnalysis,
  runVisualRepair,
  resolvePostRepairOutcome,
  visualRepairReportToValidationResult,
} from "@/lib/repair/visual-repair-controller";
import {
  buildRenderFailureLog,
  renderScadArtifacts,
} from "@/lib/tools/scad-renderer";
import {
  cleanupArtifactWorkspace,
  materializeStoredArtifact,
} from "@/lib/tools/artifact-store";
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from "@/lib/tools/validation-tool";
import { buildJobQuality } from "@/lib/validation/job-quality";
import { isModelMultimodal } from "@/app/api/models/route";
import type { RenderedArtifacts } from "@/lib/harness/types";
import { toPublicJobOrNull } from "@/lib/public-job";

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/visual-repair
 *
 * User-triggered visual repair: sends the preview image to a VLM,
 * identifies visual issues, repairs the SCAD, and re-renders.
 */
export async function POST(
  request: Request,
  { params }: RouteParams
) {
  let activeJobId: string | null = null;
  let existingExecutionLogs: string | null = null;
  try {
    const access = await getJobAccessScope(request);
    if (!access) {
      return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    }
    const { id } = await params;
    activeJobId = id;
    const job = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    existingExecutionLogs = job.executionLogs;

    if (!job.scadSource) {
      return NextResponse.json(
        { error: "No SCAD source to repair" },
        { status: 400 }
      );
    }

    // Check if the job's model supports vision
    if (job.modelId && !isModelMultimodal(job.modelId)) {
      return NextResponse.json(
        {
          error: `Model "${job.modelId}" does not support vision. Switch to a vision-capable model (e.g. mimo-v2.5, gpt-5.6, claude-sonnet-5) in job settings before running visual repair.`,
        },
        { status: 400 }
      );
    }

    // Get the preview image path
    const preview = await materializeStoredArtifact(
      id,
      job.pngPath,
      job.renderLog,
      "png"
    );
    if (!preview) {
      return NextResponse.json(
        { error: "Preview artifact is unavailable for visual repair" },
        { status: 409 }
      );
    }

    // Atomically claim the job before any paid model call or render. A second
    // click/request receives 409 instead of racing artifacts and database state.
    const claim = await db.job.updateMany({
      where: {
        id,
        ...jobAccessFilter(access),
        state: "HUMAN_REVIEW",
      },
      data: {
        state: "REPAIRING",
        executionLogs: appendLog(
          job.executionLogs,
          "VISUAL_REPAIRING",
          "User triggered visual repair — running VLM analysis..."
        ),
      },
    });
    if (claim.count !== 1) {
      if (preview.temporary) await cleanupArtifactWorkspace(preview.filePath);
      return NextResponse.json(
        { error: "Visual repair is already running or the job state changed" },
        { status: 409 },
      );
    }

    let visualRepairResult: Awaited<ReturnType<typeof runVisualRepair>>;
    try {
      visualRepairResult = await runVisualRepair({
        originalRequest: job.inputRequest,
        partFamily: job.partFamily,
        scadSource: job.scadSource,
        previewImagePath: preview.filePath,
        requestedModel: job.modelId,
        signal: AbortSignal.timeout(120_000),
      });
    } finally {
      if (preview.temporary) {
        await cleanupArtifactWorkspace(preview.filePath);
      }
    }
    const { repairedScad, visualReport, repairSummary } = visualRepairResult;

    // Re-render with repaired SCAD
    clearValidationCache();
    let artifacts: RenderedArtifacts | null = null;

    try {
      artifacts = await renderScadArtifacts(id, repairedScad);
    } catch (renderError) {
      console.error("Visual repair SCAD failed to render", {
        name: renderError instanceof Error ? renderError.name : "UnknownError",
      });
      const errMsg = "Visual repair SCAD failed to render";
      const quality = buildJobQuality({
        state: "GEOMETRY_FAILED",
        scadSource: repairedScad,
        stlPath: null,
        pngPath: null,
        validationResults: [
          visualRepairReportToValidationResult(visualReport),
        ],
      });
      await db.job.updateMany({
        where: { id, state: "REPAIRING" },
        data: {
          state: "GEOMETRY_FAILED",
          scadSource: repairedScad,
          stlPath: null,
          pngPath: null,
          renderLog: JSON.stringify(buildRenderFailureLog(0, [errMsg])),
          qualityScore: quality.qualityScore,
          validationReportJson: quality.validationReportJson,
          executionLogs: appendLog(
            job.executionLogs,
            "GEOMETRY_FAILED",
            `Visual repair SCAD failed to render: ${errMsg}`
          ),
        },
      });
      return NextResponse.json({
        job: toPublicJobOrNull(await db.job.findUnique({ where: { id } })),
        repaired: false,
        visualReport,
        error: errMsg,
      });
    }

    if (!artifacts) {
      return NextResponse.json(
        { error: "Visual repair did not return rendered artifacts" },
        { status: 500 }
      );
    }

    let finalVisualReport = visualReport;
    let visualValidationResult;
    if (visualReport.visual_issues.length > 0) {
      try {
        finalVisualReport = (await runVisualAnalysis({
          originalRequest: job.inputRequest,
          partFamily: job.partFamily,
          previewImagePath: artifacts.pngFilePath,
          requestedModel: job.modelId,
          signal: AbortSignal.timeout(45_000),
        })).visualReport;
        visualValidationResult = visualRepairReportToValidationResult(finalVisualReport);
      } catch (error) {
        console.error("Post-repair visual evaluation failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        visualValidationResult = {
          rule_id: "V001",
          rule_name: "Visual Design Intent Match",
          level: "SEMANTIC",
          passed: false,
          status: "ERROR" as const,
          is_critical: true,
          message: "Post-repair visual evaluation unavailable",
        };
      }
    } else {
      visualValidationResult = visualRepairReportToValidationResult(finalVisualReport);
    }

    // Run the blind post-repair visual check before deterministic validation;
    // serverless validation cleans the temporary render workspace afterward.
    const validationResults = await validateRenderedArtifacts({
      jobId: id,
      inputRequest: job.inputRequest,
      partFamily: job.partFamily,
      scadSource: repairedScad,
      stlFilePath: artifacts.stlFilePath,
      previewImagePath: artifacts.pngFilePath,
      wallThickness: 2,
      renderLog: artifacts.renderLog,
      skipVisual: true,
    });
    validationResults.push(visualValidationResult);

    const criticalFailures = getCriticalValidationFailures(validationResults);
    const { nextState, repaired, reviewReasons } = resolvePostRepairOutcome(
      criticalFailures.map((rule) => rule.rule_id),
      visualValidationResult.status,
    );
    const quality = buildJobQuality({
      state: nextState,
      scadSource: repairedScad,
      stlPath: artifacts.stlPath,
      pngPath: artifacts.pngPath,
      validationResults,
    });

    // Update job with repaired result
    const committed = await db.job.updateMany({
      where: { id, state: "REPAIRING" },
      data: {
        state: nextState,
        scadSource: repairedScad,
        stlPath: artifacts.stlPath,
        pngPath: artifacts.pngPath,
        renderLog: JSON.stringify(artifacts.renderLog),
        validationResults: JSON.stringify(validationResults),
        visualRepairReportJson: JSON.stringify(finalVisualReport),
        qualityScore: quality.qualityScore,
        validationReportJson: quality.validationReportJson,
        completedAt: nextState === "DELIVERED" ? new Date() : null,
        executionLogs: appendLog(
          job.executionLogs,
          nextState === "DELIVERED" ? "DELIVERED" : "HUMAN_REVIEW",
          nextState === "DELIVERED"
            ? `Visual repair complete and delivered: ${repairSummary} (post-repair match: ${(finalVisualReport.overall_visual_match * 100).toFixed(0)}%)`
            : `Visual repair rendered but still needs review: ${reviewReasons.join(", ")}`
        ),
      },
    });
    if (committed.count !== 1) {
      return NextResponse.json(
        { error: "Visual repair result was superseded by a newer job state" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      job: toPublicJobOrNull(await db.job.findUnique({ where: { id } })),
      repaired,
      visualReport: finalVisualReport,
      repairSummary,
    });
  } catch (error) {
    console.error("Visual repair failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    if (activeJobId) {
      try {
        await db.job.updateMany({
          where: { id: activeJobId, state: "REPAIRING" },
          data: {
            state: "HUMAN_REVIEW",
            completedAt: null,
            executionLogs: appendLog(
              existingExecutionLogs,
              "HUMAN_REVIEW",
              "Visual repair was interrupted or unavailable; manual review is required",
            ),
          },
        });
      } catch {
        // Preserve the stable public error even if recovery persistence fails.
      }
    }
    return NextResponse.json(
      { error: "Visual repair unavailable; retry or review the job manually" },
      { status: 500 }
    );
  }
}
