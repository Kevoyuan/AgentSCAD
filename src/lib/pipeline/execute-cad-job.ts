import { db } from "@/lib/db";
import { MIMO_DEFAULT_MODEL } from "@/lib/mimo";
import { appendLog, incrementRetryCount, parameterDefsToValues } from "@/lib/stores/job-store";
import {
  detectPartFamily,
  generateMockScadCode,
  getParameterSchema,
  runScadGenerationSkill,
} from "@/lib/harness/skill-runner";
import { buildRenderFailureLog, renderScadArtifacts } from "@/lib/tools/scad-renderer";
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from "@/lib/tools/validation-tool";
import { runRepair } from "@/lib/repair/repair-controller";
import {
  recordParameterDrift,
  recordValidationFailure,
} from "@/lib/improvement-analyzer";
import type {
  ParameterDef,
  PartFamily,
  RenderedArtifacts,
  StructuredGenerationResult,
} from "@/lib/harness/types";

export type ProcessSseEvent = Record<string, unknown>;
export type ProcessEventSink = (data: ProcessSseEvent) => void;

export const PROCESSABLE_JOB_STATES = [
  "NEW",
  "DELIVERED",
  "VALIDATION_FAILED",
  "GEOMETRY_FAILED",
  "RENDER_FAILED",
  "HUMAN_REVIEW",
];

export function canProcessJobState(state: string): boolean {
  return PROCESSABLE_JOB_STATES.includes(state);
}

export function processableJobStatesMessage(): string {
  return PROCESSABLE_JOB_STATES.join(", ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeCadJob(jobId: string, sendEvent: ProcessEventSink) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Job not found with id: ${jobId}`);
  }

  try {
    let paramValues: Record<string, unknown> = {};
    if (job.parameterValues) {
      try {
        paramValues = JSON.parse(job.parameterValues);
      } catch {
        paramValues = {};
      }
    }

    const wallThickness = (paramValues.wall_thickness as number) ?? 2.0;
    const inputRequest = job.inputRequest ?? "generic part";

    sendEvent({ state: "NEW", step: "starting", message: "Starting job processing pipeline..." });
    await delay(800);

    let generationResult: StructuredGenerationResult;
    let usedLLM = false;

    try {
      sendEvent({
        state: "NEW",
        step: "generating_llm",
        message: `Generating SCAD code via ${job.modelId || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL}...`,
      });
      generationResult = await runScadGenerationSkill(inputRequest, paramValues, job.modelId);
      usedLLM = true;
    } catch (llmError) {
      const errMsg = llmError instanceof Error ? llmError.message : "Unknown LLM error";
      console.warn(`LLM generation failed, falling back to mock: ${errMsg}`);
      sendEvent({
        state: "NEW",
        step: "generating_mock",
        message: `LLM unavailable (${errMsg}), using template generation...`,
      });
      await delay(300);
      generationResult = await generateMockScadCode(inputRequest, paramValues);
    }

    const partFamily = detectPartFamily(inputRequest);
    let scadCode = generationResult.scad_source;
    const generationPath = usedLLM ? "llm_parametric" : "template_parametric";
    const builderName = usedLLM
      ? `AgentSCAD-LLM-${partFamily}`
      : `AgentSCAD-Template-${partFamily}`;

    await db.job.update({
      where: { id: jobId },
      data: {
        state: "SCAD_GENERATED",
        partFamily,
        scadSource: scadCode,
        builderName,
        generationPath,
        parameterSchema: JSON.stringify(generationResult.parameters),
        parameterValues: JSON.stringify(parameterDefsToValues(generationResult.parameters)),
        cadIntentJson: JSON.stringify({
          part_type: generationResult.part_type,
          summary: generationResult.summary,
          units: generationResult.units,
          features: generationResult.features,
          constraints: generationResult.constraints,
          design_rationale: generationResult.design_rationale,
        }),
        modelingPlanJson: JSON.stringify(generationResult.modeling_plan),
        validationTargetsJson: JSON.stringify(generationResult.validation_targets),
        researchResult: JSON.stringify({
          part_family: partFamily,
          generation_method: usedLLM ? "llm" : "template",
          summary: generationResult.summary,
          references_found: usedLLM ? 0 : 3,
          similar_designs: usedLLM ? [] : ["standard_box_enclosure_v1", "parametric_case_v2"],
          best_practices: ["Minimum wall thickness 1.2mm for FDM", "Add fillets for strength"],
        }),
        intentResult: JSON.stringify({
          geometry_type: generationResult.part_type || partFamily,
          features: generationResult.features.map((f) => f.name),
          constraints: generationResult.constraints.geometry,
        }),
        designResult: JSON.stringify({
          approach: generationPath,
          model_id: job.modelId || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL,
          parameters_mapped: generationResult.parameters.map((p) => p.key),
          llm_used: usedLLM,
        }),
        executionLogs: appendLog(
          job.executionLogs,
          "SCAD_GENERATED",
          `SCAD code generated via ${usedLLM ? "LLM" : "template"} (family: ${partFamily})`
        ),
      },
    });

    sendEvent({
      state: "SCAD_GENERATED",
      step: "scad_generated",
      message: `SCAD code generated successfully via ${usedLLM ? "LLM" : "template"}`,
      scadSource: scadCode,
      parameters: generationResult.parameters,
      partFamily,
    });
    await delay(1200);

    sendEvent({
      state: "SCAD_GENERATED",
      step: "rendering",
      message: "Rendering STL and preview image with OpenSCAD...",
    });

    let warnings: string[] = [];
    let renderedArtifacts: RenderedArtifacts | null = null;

    try {
      sendEvent({ state: "SCAD_GENERATED", step: "rendering", message: "Generating STL..." });
      sendEvent({ state: "SCAD_GENERATED", step: "rendering", message: "Generating PNG preview..." });

      renderedArtifacts = await renderScadArtifacts(jobId, scadCode);
      clearValidationCache();
    } catch (execError) {
      const renderError =
        execError instanceof Error ? execError.message : "Unknown OpenSCAD render error";
      warnings.push(`OpenSCAD rendering failed: ${renderError}`);

      console.warn("OpenSCAD rendering failed:", execError);

      await db.job.update({
        where: { id: jobId },
        data: {
          state: "GEOMETRY_FAILED",
          renderLog: JSON.stringify(buildRenderFailureLog(0, warnings)),
          executionLogs: appendLog(
            (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
            "GEOMETRY_FAILED",
            `OpenSCAD render failed: ${renderError}`
          ),
        },
      });

      sendEvent({
        state: "GEOMETRY_FAILED",
        step: "render_failed",
        message: "OpenSCAD render failed. Real STL/PNG artifacts were not generated.",
        error: renderError,
      });
      return;
    }

    if (!renderedArtifacts) {
      throw new Error("OpenSCAD render did not return artifact paths");
    }

    await db.job.update({
      where: { id: jobId },
      data: {
        state: "RENDERED",
        stlPath: renderedArtifacts.stlPath,
        pngPath: renderedArtifacts.pngPath,
        renderLog: JSON.stringify(renderedArtifacts.renderLog),
        executionLogs: appendLog(
          (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
          "RENDERED",
          `STL and PNG rendered successfully (${renderedArtifacts.renderLog.render_time_ms}ms)`
        ),
      },
    });

    sendEvent({
      state: "RENDERED",
      step: "rendered",
      message: "STL and PNG rendered successfully",
      stlPath: renderedArtifacts.stlPath,
      pngPath: renderedArtifacts.pngPath,
    });
    await delay(1000);

    sendEvent({
      state: "RENDERED",
      step: "validating",
      message: "Running validation rules...",
    });
    await delay(1200);

    const validationResults = await validateRenderedArtifacts({
      inputRequest,
      partFamily,
      scadSource: scadCode,
      stlFilePath: renderedArtifacts.stlFilePath,
      previewImagePath: renderedArtifacts.pngFilePath,
      wallThickness,
      renderLog: renderedArtifacts.renderLog,
      validationTargets: generationResult.validation_targets,
      skipVisual: true, // Phase 4: visual validation is user-triggered only
    });
    const criticalFailures = getCriticalValidationFailures(validationResults);
    let wasRepaired = false;

    // v3.0 memory: record validation failures for learning
    try {
      for (const result of validationResults) {
        if (!result.passed) {
          recordValidationFailure({
            family: partFamily ?? "unknown",
            ruleId: result.rule_id,
            ruleName: result.rule_name,
            passed: false,
            repairSucceeded: null, // repair hasn't run yet
          }).catch(() => { /* non-critical */ });
        }
      }
    } catch { /* memory system is non-critical */ }

    if (criticalFailures.length > 0) {
      // Attempt auto-repair once (Phase 3: validation-driven repair)
      const currentRetryCount = job.retryCount ?? 0;
      const maxAutoRepairs = 1;

      if (currentRetryCount < maxAutoRepairs) {
        sendEvent({
          state: "RENDERED",
          step: "repairing",
          message: `Validation found ${criticalFailures.length} critical failure(s). Attempting automatic repair...`,
        });

        await db.job.update({
          where: { id: jobId },
          data: {
            state: "REPAIRING",
            validationResults: JSON.stringify(validationResults),
            executionLogs: appendLog(
              (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
              "REPAIRING",
              `Auto-repair attempt ${currentRetryCount + 1}: ${criticalFailures.map((r) => r.rule_id).join(", ")}`
            ),
          },
        });

        try {
          const repairResult = await runRepair({
            originalRequest: inputRequest,
            partFamily: partFamily ?? "unknown",
            currentScadCode: scadCode,
            validationResults,
            cadIntent: {
              part_type: generationResult.part_type,
              features: generationResult.features,
              constraints: generationResult.constraints,
              modeling_plan: generationResult.modeling_plan,
              validation_targets: generationResult.validation_targets,
            },
            requestedModel: job.modelId,
          });

          await incrementRetryCount(jobId);
          const repairedScad = repairResult.generationResult.scad_source;

          sendEvent({
            state: "REPAIRING",
            step: "repair_rendering",
            message: `Repair applied: ${repairResult.repairMeta.repair_summary}. Re-rendering...`,
          });

          // Re-render with repaired SCAD
          let repairedArtifacts: RenderedArtifacts | null = null;
          try {
            clearValidationCache();
            repairedArtifacts = await renderScadArtifacts(jobId, repairedScad);
          } catch (reRenderError) {
            const msg = reRenderError instanceof Error ? reRenderError.message : "Unknown";
            await db.job.update({
              where: { id: jobId },
              data: {
                state: "HUMAN_REVIEW",
                scadSource: repairedScad,
                executionLogs: appendLog(
                  (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
                  "HUMAN_REVIEW",
                  `Repair generated valid SCAD but re-render failed: ${msg}`
                ),
              },
            });
            sendEvent({
              state: "HUMAN_REVIEW",
              step: "repair_render_failed",
              message: `Repair SCAD was generated but OpenSCAD render failed: ${msg}`,
            });
            return;
          }

          // Re-validate
          if (repairedArtifacts) {
            const revalidationResults = await validateRenderedArtifacts({
              inputRequest,
              partFamily,
              scadSource: repairedScad,
              stlFilePath: repairedArtifacts.stlFilePath,
              previewImagePath: repairedArtifacts.pngFilePath,
              wallThickness,
              renderLog: repairedArtifacts.renderLog,
              validationTargets: generationResult.validation_targets,
              skipVisual: true,
            });
            const stillFailing = getCriticalValidationFailures(revalidationResults);

            if (stillFailing.length > 0) {
              await db.job.update({
                where: { id: jobId },
                data: {
                  state: "HUMAN_REVIEW",
                  scadSource: repairedScad,
                  stlPath: repairedArtifacts.stlPath,
                  pngPath: repairedArtifacts.pngPath,
                  validationResults: JSON.stringify(revalidationResults),
                  reportPath: `/artifacts/${jobId}/report`,
                  executionLogs: appendLog(
                    (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
                    "HUMAN_REVIEW",
                    `Auto-repair completed but ${stillFailing.length} critical failure(s) remain: ${stillFailing.map((r) => r.rule_id).join(", ")}`
                  ),
                },
              });
              sendEvent({
                state: "HUMAN_REVIEW",
                step: "repair_partial",
                message: `Auto-repair completed but ${stillFailing.length} issue(s) remain. Manual review needed.`,
                validationResults: revalidationResults,
              });
              return;
            }

            // Repair succeeded — update job and continue to delivery
            scadCode = repairedScad; // use repaired SCAD going forward
            await db.job.update({
              where: { id: jobId },
              data: {
                scadSource: repairedScad,
                stlPath: repairedArtifacts.stlPath,
                pngPath: repairedArtifacts.pngPath,
                validationResults: JSON.stringify(revalidationResults),
                reportPath: `/artifacts/${jobId}/report`,
                executionLogs: appendLog(
                  (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
                  "VALIDATED",
                  `Auto-repair successful — all critical validation rules pass after repair`
                ),
              },
            });
            sendEvent({
              state: "VALIDATED",
              step: "repair_success",
              message: `Auto-repair successful! ${repairResult.repairMeta.repair_summary}`,
              validationResults: revalidationResults,
            });
            await delay(800);
            wasRepaired = true;
            // Fall through to DELIVERED below
          }
        } catch (repairError) {
          const errMsg = repairError instanceof Error ? repairError.message : "Unknown";
          console.warn("Auto-repair failed:", errMsg);
          sendEvent({
            state: "HUMAN_REVIEW",
            step: "repair_error",
            message: `Auto-repair attempt failed: ${errMsg}. Manual review needed.`,
          });
          await db.job.update({
            where: { id: jobId },
            data: {
              state: "HUMAN_REVIEW",
              executionLogs: appendLog(
                (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
                "HUMAN_REVIEW",
                `Auto-repair failed: ${errMsg}`
              ),
            },
          });
          return;
        }

        // Repair succeeded — skip the HUMAN_REVIEW return and continue to DELIVERED
        sendEvent({
          state: "VALIDATED",
          step: "validated",
          message: "Validation passed after repair - all critical rules satisfied",
        });
        await delay(800);
      } else {
        // Already tried max repairs — go to HUMAN_REVIEW
        await db.job.update({
          where: { id: jobId },
          data: {
            state: "HUMAN_REVIEW",
            validationResults: JSON.stringify(validationResults),
            reportPath: `/artifacts/${jobId}/report`,
            executionLogs: appendLog(
              (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
              "HUMAN_REVIEW",
              `Max auto-repairs (${maxAutoRepairs}) reached; validation blockers: ${criticalFailures.map((rule) => `${rule.rule_id} ${rule.rule_name}`).join(", ")}`
            ),
          },
        });

        sendEvent({
          state: "HUMAN_REVIEW",
          step: "validation_failed",
          message: "Rendered successfully; max auto-repairs reached, manual review required",
          validationResults,
        });
        return;
      }
    }

    if (!wasRepaired) {
      await db.job.update({
        where: { id: jobId },
        data: {
          state: "VALIDATED",
          validationResults: JSON.stringify(validationResults),
          reportPath: `/artifacts/${jobId}/report`,
          executionLogs: appendLog(
            (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
            "VALIDATED",
            (() => {
              const actionable = validationResults.filter((r) => !r.message.toLowerCase().startsWith("skipped"));
              const skipped = validationResults.length - actionable.length;
              return `Validation passed: ${actionable.filter((r) => r.passed).length}/${actionable.length} actionable rules passed` +
                (skipped > 0 ? `, ${skipped} skipped` : " [real mesh analysis]");
            })()
          ),
        },
      });

      sendEvent({
        state: "VALIDATED",
        step: "validated",
        message: "Validation passed - all critical rules satisfied",
        validationResults,
      });
      await delay(800);
    }

    sendEvent({
      state: "VALIDATED",
      step: "delivering",
      message: "Preparing final deliverables...",
    });
    await delay(600);

    await db.job.update({
      where: { id: jobId },
      data: {
        state: "DELIVERED",
        completedAt: new Date(),
        executionLogs: appendLog(
          (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
          "DELIVERED",
          "Job completed and deliverables ready"
        ),
      },
    });

    const finalJob = await db.job.findUnique({ where: { id: jobId } });

    // v3.0 memory: record parameter drift for learning
    try {
      for (const param of generationResult.parameters) {
        const schemaDefault = param.value;
        const finalParams = paramValues;
        const userValue = (finalParams as Record<string, unknown>)[param.key] as number | undefined;
        if (userValue !== undefined && Math.abs(userValue - schemaDefault) > 0.01) {
          recordParameterDrift({
            family: partFamily ?? "unknown",
            parameter: param.key,
            default_value: schemaDefault,
            user_value: userValue,
            source: "user_edit",
            deliverySucceeded: true,
            repairSucceeded: wasRepaired ? true : null,
          }).catch(() => { /* non-critical */ });
        }
      }
    } catch { /* memory system is non-critical */ }

    sendEvent({
      state: "DELIVERED",
      step: "delivered",
      message: "Job completed successfully! All deliverables are ready.",
      job: finalJob,
    });
  } catch (error) {
    console.error("Error during job processing:", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    await db.job.update({
      where: { id: jobId },
      data: {
        state: "GEOMETRY_FAILED",
        executionLogs: appendLog(
          (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
          "GEOMETRY_FAILED",
          `Processing failed: ${message}`
        ),
      },
    });

    sendEvent({
      state: "GEOMETRY_FAILED",
      step: "error",
      message: `Processing failed: ${message}`,
    });
  }
}
