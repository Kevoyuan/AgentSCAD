import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendLog } from "@/lib/stores/job-store";
import { runVisualRepair } from "@/lib/repair/visual-repair-controller";
import { renderScadArtifacts, getRenderedArtifactPaths } from "@/lib/tools/scad-renderer";
import { clearValidationCache } from "@/lib/tools/validation-tool";

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
    const { id } = await params;
    const job = await db.job.findUnique({ where: { id } });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!job.scadSource) {
      return NextResponse.json(
        { error: "No SCAD source to repair" },
        { status: 400 }
      );
    }

    // Get the preview image path
    const paths = getRenderedArtifactPaths(id);
    const previewImagePath = paths.pngFilePath;

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

    const { repairedScad, visualReport, repairSummary } = await runVisualRepair({
      originalRequest: job.inputRequest,
      partFamily: job.partFamily,
      scadSource: job.scadSource,
      previewImagePath,
      requestedModel: job.modelId,
    });

    // Re-render with repaired SCAD
    clearValidationCache();
    let stlPath: string | null = null;
    let pngPath: string | null = null;
    let renderSucceeded = false;

    try {
      const artifacts = await renderScadArtifacts(id, repairedScad);
      stlPath = artifacts.stlPath;
      pngPath = artifacts.pngPath;
      renderSucceeded = true;
    } catch (renderError) {
      const errMsg = renderError instanceof Error ? renderError.message : "Unknown";
      await db.job.update({
        where: { id },
        data: {
          state: "HUMAN_REVIEW",
          scadSource: repairedScad,
          executionLogs: appendLog(
            job.executionLogs,
            "GEOMETRY_FAILED",
            `Visual repair SCAD failed to render: ${errMsg}`
          ),
        },
      });
      return NextResponse.json({
        job: await db.job.findUnique({ where: { id } }),
        repaired: false,
        visualReport,
        error: `Visual repair SCAD failed to render: ${errMsg}`,
      });
    }

    // Update job with repaired result
    await db.job.update({
      where: { id },
      data: {
        state: renderSucceeded ? "VALIDATED" : "HUMAN_REVIEW",
        scadSource: repairedScad,
        stlPath,
        pngPath,
        validationResults: JSON.stringify([
          {
            rule_id: "V001",
            rule_name: "Visual Design Intent Match",
            level: "SEMANTIC",
            passed: visualReport.visual_issues.length === 0,
            is_critical: true,
            message: visualReport.repair_summary,
          },
        ]),
        executionLogs: appendLog(
          job.executionLogs,
          "VISUAL_REPAIRED",
          `Visual repair complete: ${repairSummary} (match: ${(visualReport.overall_visual_match * 100).toFixed(0)}%)`
        ),
      },
    });

    return NextResponse.json({
      job: await db.job.findUnique({ where: { id } }),
      repaired: true,
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
