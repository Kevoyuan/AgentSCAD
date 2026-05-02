import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendLog, incrementRetryCount } from "@/lib/stores/job-store";
import { runRepair } from "@/lib/repair/repair-controller";
import { renderScadArtifacts } from "@/lib/tools/scad-renderer";
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from "@/lib/tools/validation-tool";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const REPAIRABLE_STATES = new Set([
  "GEOMETRY_FAILED",
  "RENDER_FAILED",
  "VALIDATION_FAILED",
  "HUMAN_REVIEW",
  "DELIVERED",
]);

export async function POST(
  _request: Request,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const job = await db.job.findUnique({ where: { id } });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!REPAIRABLE_STATES.has(job.state)) {
      return NextResponse.json({
        job,
        repaired: false,
        recommendation: "none",
        reason: `Job state '${job.state}' is not repairable.`,
      });
    }

    // Need SCAD source to repair
    if (!job.scadSource) {
      return NextResponse.json({
        job,
        repaired: false,
        recommendation: "retry",
        reason: "No SCAD source available to repair. Re-process the job instead.",
      });
    }

    // Parse existing validation results
    let validationResults: Array<{
      rule_id: string; rule_name: string; level: string;
      passed: boolean; is_critical: boolean; message: string;
    }> = [];
    try {
      if (job.validationResults) {
        validationResults = JSON.parse(job.validationResults);
      }
    } catch {
      // continue with empty results
    }

    // Parse CAD intent from stored JSON
    let cadIntent: Record<string, unknown> | undefined;
    try {
      if (job.cadIntentJson) {
        cadIntent = JSON.parse(job.cadIntentJson);
      }
    } catch {
      // continue without intent
    }

    // Set job to REPAIRING state
    await db.job.update({
      where: { id },
      data: {
        state: "REPAIRING",
        executionLogs: appendLog(job.executionLogs, "REPAIRING", "Starting LLM-driven repair..."),
      },
    });

    // Run repair
    const retryRound = await incrementRetryCount(id);
    const { generationResult: repaired, repairMeta } = await runRepair({
      originalRequest: job.inputRequest,
      partFamily: job.partFamily || "unknown",
      currentScadCode: job.scadSource,
      validationResults: validationResults as Parameters<typeof runRepair>[0]["validationResults"],
      cadIntent: cadIntent as Parameters<typeof runRepair>[0]["cadIntent"],
      requestedModel: job.modelId,
    });

    const sanitized = sanitizeGeneratedScadSource(repaired.scad_source);

    // Try re-rendering
    let renderSucceeded = false;
    let stlPath: string | null = null;
    let pngPath: string | null = null;
    let renderLog: import("@/lib/harness/types").RenderLog | null = null;
    let stlFilePath: string | null = null;
    let pngFilePath: string | null = null;

    try {
      const artifacts = await renderScadArtifacts(id, sanitized);
      clearValidationCache();
      stlPath = artifacts.stlPath;
      pngPath = artifacts.pngPath;
      stlFilePath = artifacts.stlFilePath;
      pngFilePath = artifacts.pngFilePath;
      renderLog = artifacts.renderLog;
      renderSucceeded = true;
    } catch (renderError) {
      const errMsg = renderError instanceof Error ? renderError.message : "Unknown render error";
      await db.job.update({
        where: { id },
        data: {
          state: "GEOMETRY_FAILED",
          scadSource: sanitized,
          repairRound: retryRound,
          executionLogs: appendLog(
            job.executionLogs,
            "GEOMETRY_FAILED",
            `Repair succeeded but re-render failed: ${errMsg}`
          ),
        },
      });
      return NextResponse.json({
        job: await db.job.findUnique({ where: { id } }),
        repaired: false,
        recommendation: "retry",
        reason: `Repair generated valid SCAD but OpenSCAD render failed: ${errMsg}`,
      });
    }

    // Re-validate using artifacts from the render above
    let revalidationResults: import("@/lib/mesh-validator").ValidationResult[] = [];
    if (renderSucceeded && stlFilePath) {
      revalidationResults = await validateRenderedArtifacts({
        inputRequest: job.inputRequest,
        partFamily: job.partFamily,
        scadSource: sanitized,
        stlFilePath,
        previewImagePath: pngFilePath!,
        wallThickness: 2,
        renderLog,
        validationTargets: cadIntent?.validation_targets as Parameters<typeof validateRenderedArtifacts>[0]["validationTargets"],
      });
    }

    const criticalFailures = getCriticalValidationFailures(revalidationResults);

    // Store repair history
    const repairEntry = {
      round: retryRound,
      timestamp: new Date().toISOString(),
      repair_summary: repairMeta.repair_summary,
      risk: repairMeta.risk,
      assumptions: repairMeta.assumptions,
      revalidation_passed: criticalFailures.length === 0,
    };

    let repairHistory: unknown[] = [];
    try {
      if (job.repairHistory) {
        repairHistory = JSON.parse(job.repairHistory);
      }
    } catch { /* use empty */ }
    repairHistory.push(repairEntry);

    if (criticalFailures.length > 0) {
      await db.job.update({
        where: { id },
        data: {
          state: "HUMAN_REVIEW",
          scadSource: sanitized,
          parameterSchema: JSON.stringify(repaired.parameters),
          parameterValues: JSON.stringify(
            repaired.parameters.reduce<Record<string, number>>((acc, p) => {
              acc[p.key] = p.value;
              return acc;
            }, {})
          ),
          stlPath,
          pngPath,
          validationResults: JSON.stringify(revalidationResults),
          cadIntentJson: JSON.stringify({
            part_type: repaired.part_type,
            summary: repaired.summary,
            features: repaired.features,
            constraints: repaired.constraints,
            design_rationale: repaired.design_rationale,
          }),
          modelingPlanJson: JSON.stringify(repaired.modeling_plan),
          validationTargetsJson: JSON.stringify(repaired.validation_targets),
          repairRound: retryRound,
          repairHistory: JSON.stringify(repairHistory),
          executionLogs: appendLog(
            job.executionLogs,
            "HUMAN_REVIEW",
            `Repair round ${retryRound} completed but still has critical failures: ${criticalFailures.map((r) => `${r.rule_id}`).join(", ")}`
          ),
        },
      });
      return NextResponse.json({
        job: await db.job.findUnique({ where: { id } }),
        repaired: false,
        recommendation: "review",
        reason: `Repair completed but ${criticalFailures.length} critical validation failure(s) remain. Manual review needed.`,
      });
    }

    // Repair succeeded — update to VALIDATED
    await db.job.update({
      where: { id },
      data: {
        state: "VALIDATED",
        scadSource: sanitized,
        parameterSchema: JSON.stringify(repaired.parameters),
        parameterValues: JSON.stringify(
          repaired.parameters.reduce<Record<string, number>>((acc, p) => {
            acc[p.key] = p.value;
            return acc;
          }, {})
        ),
        stlPath,
        pngPath,
        validationResults: JSON.stringify(revalidationResults),
        cadIntentJson: JSON.stringify({
          part_type: repaired.part_type,
          summary: repaired.summary,
          features: repaired.features,
          constraints: repaired.constraints,
          design_rationale: repaired.design_rationale,
        }),
        modelingPlanJson: JSON.stringify(repaired.modeling_plan),
        validationTargetsJson: JSON.stringify(repaired.validation_targets),
        repairRound: retryRound,
        repairHistory: JSON.stringify(repairHistory),
        executionLogs: appendLog(
          job.executionLogs,
          "VALIDATED",
          `Repair round ${retryRound} successful — all critical validation rules pass`
        ),
      },
    });

    return NextResponse.json({
      job: await db.job.findUnique({ where: { id } }),
      repaired: true,
      recommendation: "repaired",
      reason: repairMeta.repair_summary,
    });
  } catch (error) {
    console.error("Repair error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to repair job: ${message}` }, { status: 500 });
  }
}
