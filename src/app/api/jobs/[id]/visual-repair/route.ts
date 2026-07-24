import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { appendLog } from "@/lib/stores/job-store";
import { runVisualRepair } from "@/lib/repair/visual-repair-controller";
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
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

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

    // Run visual repair
    await db.job.update({
      where: { id },
      data: {
        state: "REPAIRING",
        executionLogs: appendLog(
          job.executionLogs,
          "VISUAL_REPAIRING",
          "User triggered visual repair — running VLM analysis..."
        ),
      },
    });

    let visualRepairResult: Awaited<ReturnType<typeof runVisualRepair>>;
    try {
      visualRepairResult = await runVisualRepair({
        originalRequest: job.inputRequest,
        partFamily: job.partFamily,
        scadSource: job.scadSource,
        previewImagePath: preview.filePath,
        requestedModel: job.modelId,
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
      const errMsg = renderError instanceof Error ? renderError.message : "Unknown";
      const quality = buildJobQuality({
        state: "GEOMETRY_FAILED",
        scadSource: repairedScad,
        stlPath: null,
        pngPath: null,
        validationResults: [
          {
            rule_id: "V001",
            rule_name: "Visual Design Intent Match",
            level: "SEMANTIC",
            passed: visualReport.visual_issues.length === 0,
            is_critical: true,
            message: visualReport.repair_summary,
          },
        ],
      });
      await db.job.update({
        where: { id },
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
        error: `Visual repair SCAD failed to render: ${errMsg}`,
      });
    }

    if (!artifacts) {
      return NextResponse.json(
        { error: "Visual repair did not return rendered artifacts" },
        { status: 500 }
      );
    }

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
    validationResults.push({
      rule_id: "V001",
      rule_name: "Visual Design Intent Match",
      level: "SEMANTIC",
      passed: visualReport.visual_issues.length === 0,
      is_critical: true,
      message: visualReport.repair_summary,
    });

    const criticalFailures = getCriticalValidationFailures(validationResults);
    const nextState = criticalFailures.length > 0 ? "HUMAN_REVIEW" : "DELIVERED";
    const quality = buildJobQuality({
      state: nextState,
      scadSource: repairedScad,
      stlPath: artifacts.stlPath,
      pngPath: artifacts.pngPath,
      validationResults,
    });

    // Update job with repaired result
    await db.job.update({
      where: { id },
      data: {
        state: nextState,
        scadSource: repairedScad,
        stlPath: artifacts.stlPath,
        pngPath: artifacts.pngPath,
        renderLog: JSON.stringify(artifacts.renderLog),
        validationResults: JSON.stringify(validationResults),
        visualRepairReportJson: JSON.stringify(visualReport),
        qualityScore: quality.qualityScore,
        validationReportJson: quality.validationReportJson,
        completedAt: nextState === "DELIVERED" ? new Date() : null,
        executionLogs: appendLog(
          job.executionLogs,
          nextState === "DELIVERED" ? "DELIVERED" : "HUMAN_REVIEW",
          nextState === "DELIVERED"
            ? `Visual repair complete and delivered: ${repairSummary} (match: ${(visualReport.overall_visual_match * 100).toFixed(0)}%)`
            : `Visual repair rendered but still needs review: ${criticalFailures.map((rule) => rule.rule_id).join(", ")}`
        ),
      },
    });

    return NextResponse.json({
      job: toPublicJobOrNull(await db.job.findUnique({ where: { id } })),
      repaired: nextState === "DELIVERED",
      visualReport,
      repairSummary,
    });
  } catch (error) {
    console.error("Visual repair error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Visual repair failed: ${message}` },
      { status: 500 }
    );
  }
}
