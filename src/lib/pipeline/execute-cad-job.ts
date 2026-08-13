import { db } from "@/lib/db";
import { MIMO_DEFAULT_MODEL } from "@/lib/mimo";
import { appendLog, incrementRetryCount, parameterDefsToValues } from "@/lib/stores/job-store";
import {
  detectPartFamily,
  generateMockScadCode,
  runScadGenerationSkill,
} from "@/lib/harness/skill-runner";
import { GeneratedScadCompileError } from "@/lib/harness/generation-errors";
import {
  buildRenderFailureLog,
  renderScadArtifacts,
  validateGeneratedScadSource,
} from "@/lib/tools/scad-renderer";
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from "@/lib/tools/validation-tool";
import { runRepair } from "@/lib/repair/repair-controller";
import { buildJobQuality } from "@/lib/validation/job-quality";
import { isValidationActionable } from "@/lib/validation/evidence-status";
import { toPublicJobOrNull } from "@/lib/public-job";
import { analyzeCadRequest } from "@/lib/intake/request-intelligence";
import { runModelCadIntake } from "@/lib/intake/model-intake";
import {
  buildApprovedGenerationRequest,
  restoreApprovedRequestIntelligence,
  restorePersistedRequestIntelligence,
} from "@/lib/intake/request-approval";
import type {
  RenderedArtifacts,
  StructuredGenerationResult,
} from "@/lib/harness/types";
import { ModelRequestError } from "@/lib/model-runtime";

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

export function getDemoDelayMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const parsed = Number(env.AGENTSCAD_DEMO_DELAY_MS ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed), 5_000);
}

export function isTemplateFallbackEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.AGENTSCAD_TEMPLATE_FALLBACK?.trim().toLowerCase() === "true";
}

function compileFailureResult(message: string) {
  const boundedMessage = message.length > 4_000
    ? `${message.slice(0, 4_000)}…`
    : message;
  return {
    rule_id: "C001",
    rule_name: "OpenSCAD Compile",
    level: "GEOMETRY",
    passed: false,
    status: "ERROR" as const,
    is_critical: true,
    message: boundedMessage,
  };
}

function demoDelay(): Promise<void> {
  const ms = getDemoDelayMs();
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

export async function executeCadJob(jobId: string, sendEvent: ProcessEventSink) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Job not found with id: ${jobId}`);
  }

  let currentStage: string = "intake";
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
    const restoredRequestIntelligence = restoreApprovedRequestIntelligence(inputRequest, job.intentResult);
    const restoredPersistedIntelligence = restoredRequestIntelligence
      ?? restorePersistedRequestIntelligence(inputRequest, job.intentResult);
    let requestIntelligence = restoredPersistedIntelligence ?? analyzeCadRequest(inputRequest);

    sendEvent({ state: "NEW", step: "starting", message: "Starting job processing pipeline..." });
    await demoDelay();

    if (!restoredPersistedIntelligence && requestIntelligence.status === "UNKNOWN") {
      sendEvent({
        state: "NEW",
        step: "analyzing_intent_llm",
        message: "Building a structured CAD brief before geometry generation...",
      });
      try {
        const modelIntelligence = await runModelCadIntake(inputRequest, job.modelId);
        if (modelIntelligence.status !== "UNKNOWN") {
          requestIntelligence = modelIntelligence;
        } else {
          sendEvent({
            state: "NEW",
            step: "intent_analysis_degraded",
            message: "The intake model returned no reliable interpretation; generation will use only the original request.",
          });
        }
      } catch (intakeError) {
        const message = intakeError instanceof Error ? intakeError.message : "Unknown intake error";
        console.warn(`CAD intake analysis failed; continuing without a model brief: ${message}`);
        sendEvent({
          state: "NEW",
          step: "intent_analysis_degraded",
          message: "Structured intake was unavailable; generation will use only the original request.",
        });
      }
    }

    sendEvent({
      state: "NEW",
      step: "intent_analyzed",
      message: requestIntelligence.status === "AMBIGUOUS"
        ? "The request has multiple plausible CAD meanings. Clarification is required before generation."
        : `Request intent analyzed: ${requestIntelligence.status.toLowerCase()}`,
      intentResult: requestIntelligence,
    });

    if (requestIntelligence.status === "AMBIGUOUS") {
      const clarificationQuestion = requestIntelligence.clarificationQuestion
        ?? "Which interpretation should AgentSCAD model?";

      await db.job.update({
        where: { id: jobId },
        data: {
          state: "HUMAN_REVIEW",
          partFamily: null,
          builderName: null,
          generationPath: "intent_clarification",
          intentResult: JSON.stringify(requestIntelligence),
          cadIntentJson: JSON.stringify({ request_intelligence: requestIntelligence }),
          scadSource: null,
          stlPath: null,
          pngPath: null,
          renderLog: null,
          reportPath: null,
          validationResults: null,
          visualRepairReportJson: null,
          validationReportJson: null,
          qualityScore: null,
          completedAt: null,
          executionLogs: appendLog(
            job.executionLogs,
            "HUMAN_REVIEW",
            `Intent clarification required: ${clarificationQuestion}`,
          ),
        },
      });

      sendEvent({
        state: "HUMAN_REVIEW",
        step: "intent_clarification_required",
        message: clarificationQuestion,
        reviewReason: "intent_ambiguous",
        clarificationQuestion,
        alternatives: requestIntelligence.interpretations,
        intentResult: requestIntelligence,
        generationPath: "intent_clarification",
      });
      return;
    }

    const generationRequest = buildApprovedGenerationRequest(inputRequest, requestIntelligence);
    // Classify only the user's request. Internal intent IDs/labels must not
    // silently route an approved assembly to an unrelated product template.
    const partFamily = detectPartFamily(inputRequest);

    let generationResult: StructuredGenerationResult;
    let usedLLM = false;

    try {
      currentStage = "generate";
      sendEvent({
        state: "NEW",
        step: "generating_llm",
        message: `Generating SCAD code via ${job.modelId || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL}...`,
      });
      generationResult = await runScadGenerationSkill(
        generationRequest,
        paramValues,
        job.modelId,
        partFamily,
      );
      usedLLM = true;
    } catch (llmError) {
      if (llmError instanceof GeneratedScadCompileError) {
        currentStage = "repair";
        const compileFailure = compileFailureResult(llmError.compileLog);
        let failedScad = llmError.generationResult.scad_source;

        sendEvent({
          state: "NEW",
          step: "compile_repairing",
          message: "Generated SCAD failed OpenSCAD compilation. Attempting one geometry repair using the compiler diagnostics...",
          errorCode: "OPENSCAD_COMPILE_FAILED",
        });

        try {
          const repairResult = await runRepair({
            originalRequest: inputRequest,
            partFamily,
            currentScadCode: failedScad,
            validationResults: [compileFailure],
            cadIntent: {
              part_type: llmError.generationResult.part_type,
              features: llmError.generationResult.features,
              constraints: llmError.generationResult.constraints,
              modeling_plan: llmError.generationResult.modeling_plan,
              validation_targets: llmError.generationResult.validation_targets,
            },
            requestedModel: job.modelId,
          });
          failedScad = repairResult.generationResult.scad_source;
          await validateGeneratedScadSource(failedScad);
          generationResult = {
            ...llmError.generationResult,
            ...repairResult.generationResult,
            parameters: repairResult.generationResult.parameters.length > 0
              ? repairResult.generationResult.parameters
              : llmError.generationResult.parameters,
            scad_source: failedScad,
          };
          usedLLM = true;
          currentStage = "generate";
          sendEvent({
            state: "NEW",
            step: "compile_repair_success",
            message: "The generated SCAD was repaired and passed OpenSCAD compilation.",
          });
        } catch (repairError) {
          const repairMessage = repairError instanceof Error
            ? repairError.message
            : "Unknown compile repair error";
          const validationResults = [
            compileFailure,
            compileFailureResult(`Automatic compile repair failed: ${repairMessage}`),
          ];
          const quality = buildJobQuality({
            state: "HUMAN_REVIEW",
            scadSource: failedScad,
            stlPath: null,
            pngPath: null,
            validationResults,
          });

          await db.job.update({
            where: { id: jobId },
            data: {
              state: "HUMAN_REVIEW",
              partFamily,
              builderName: "AgentSCAD-LLM-compile-repair",
              generationPath: "llm_compile_repair_failed",
              scadSource: failedScad,
              stlPath: null,
              pngPath: null,
              renderLog: JSON.stringify(buildRenderFailureLog(0, [repairMessage])),
              validationResults: JSON.stringify(validationResults),
              qualityScore: quality.qualityScore,
              validationReportJson: quality.validationReportJson,
              executionLogs: appendLog(
                job.executionLogs,
                "OPENSCAD_COMPILE_FAILED",
                `Generated SCAD and automatic repair both failed OpenSCAD compilation: ${repairMessage}`,
              ),
            },
          });
          sendEvent({
            state: "HUMAN_REVIEW",
            step: "compile_repair_failed",
            message: "Generated SCAD and its automatic repair both failed OpenSCAD compilation. The latest source is preserved for review.",
            errorCode: "OPENSCAD_COMPILE_FAILED",
            failureStage: "generate",
            retryable: true,
            validationResults,
          });
          return;
        }
      } else {
        const errMsg = llmError instanceof Error ? llmError.message : "Unknown LLM error";
        const canUseDemoTemplate = partFamily !== "unknown" && isTemplateFallbackEnabled();
        if (!canUseDemoTemplate) {
          const errorCode = llmError instanceof ModelRequestError
            ? llmError.code
            : "LLM_UNAVAILABLE";
          console.warn(`LLM freeform generation failed [${errorCode}]: ${errMsg}`);
          throw llmError;
        }
        console.warn(`LLM generation failed, using explicit demo fallback for ${partFamily}: ${errMsg}`);
        sendEvent({ state: "NEW", step: "generating_mock", message: `LLM unavailable (${errMsg}); explicit demo fallback is generating the ${partFamily} template...` });
        await demoDelay();
        generationResult = await generateMockScadCode(generationRequest, paramValues, partFamily);
      }
    }

    let scadCode = generationResult.scad_source;
    const generationPath = usedLLM
      ? partFamily === "unknown"
        ? "llm_freeform_parametric"
        : "llm_parametric"
      : "template_demo_fallback";
    const builderName = usedLLM
      ? partFamily === "unknown"
        ? "AgentSCAD-LLM-freeform"
        : `AgentSCAD-LLM-${partFamily}`
      : `AgentSCAD-DemoTemplate-${partFamily}`;

    await db.job.update({
      where: { id: jobId },
      data: {
        state: "SCAD_GENERATED",
        partFamily,
        scadSource: scadCode,
        stlPath: null,
        pngPath: null,
        renderLog: null,
        builderName,
        generationPath,
        parameterSchema: JSON.stringify(generationResult.parameters),
        parameterValues: JSON.stringify(parameterDefsToValues(generationResult.parameters)),
        cadIntentJson: JSON.stringify({
          request_intelligence: requestIntelligence,
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
        // Keep the approved intake at the top level so a later re-process can
        // restore the user's choice without another clarification/model call.
        // Generated geometry metadata already lives in cadIntentJson above.
        intentResult: JSON.stringify(requestIntelligence),
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
    await demoDelay();

    sendEvent({
      state: "SCAD_GENERATED",
      step: "rendering",
      message: "Rendering STL and preview image with OpenSCAD...",
    });

    currentStage = "render";
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
      const quality = buildJobQuality({
        state: "GEOMETRY_FAILED",
        scadSource: scadCode,
        stlPath: null,
        pngPath: null,
        validationResults: [],
      });

      await db.job.update({
        where: { id: jobId },
        data: {
          state: "GEOMETRY_FAILED",
          stlPath: null,
          pngPath: null,
          renderLog: JSON.stringify(buildRenderFailureLog(0, warnings)),
          qualityScore: quality.qualityScore,
          validationReportJson: quality.validationReportJson,
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
        qualityReport: quality.readiness,
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
    await demoDelay();

    currentStage = "validate";
    sendEvent({
      state: "RENDERED",
      step: "validating",
      message: "Running validation rules...",
    });
    await demoDelay();

    const validationResults = await validateRenderedArtifacts({
      jobId,
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
    const validationQuality = buildJobQuality({
      state: criticalFailures.length > 0 ? "HUMAN_REVIEW" : "DELIVERED",
      scadSource: scadCode,
      stlPath: renderedArtifacts.stlPath,
      pngPath: renderedArtifacts.pngPath,
      validationResults,
    });
    let wasRepaired = false;

    if (criticalFailures.length > 0) {
      // Attempt auto-repair once (Phase 3: validation-driven repair)
      const currentRetryCount = job.retryCount ?? 0;
      const maxAutoRepairs = 1;

      if (currentRetryCount < maxAutoRepairs) {
        currentStage = "repair";
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
            qualityScore: validationQuality.qualityScore,
            validationReportJson: validationQuality.validationReportJson,
            executionLogs: appendLog(
              (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
              "REPAIRING",
              `Auto-repair attempt ${currentRetryCount + 1}: ${criticalFailures.map((r) => r.rule_id).join(", ")}`
            ),
          },
        });

        try {
          await incrementRetryCount(jobId);

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
                stlPath: null,
                pngPath: null,
                renderLog: JSON.stringify(buildRenderFailureLog(0, [msg])),
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
              jobId,
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
            const repairQuality = buildJobQuality({
              state: stillFailing.length > 0 ? "HUMAN_REVIEW" : "DELIVERED",
              scadSource: repairedScad,
              stlPath: repairedArtifacts.stlPath,
              pngPath: repairedArtifacts.pngPath,
              validationResults: revalidationResults,
            });

            if (stillFailing.length > 0) {
              await db.job.update({
                where: { id: jobId },
                data: {
                  state: "HUMAN_REVIEW",
                  scadSource: repairedScad,
                  stlPath: repairedArtifacts.stlPath,
                  pngPath: repairedArtifacts.pngPath,
                  renderLog: JSON.stringify(repairedArtifacts.renderLog),
                  validationResults: JSON.stringify(revalidationResults),
                  qualityScore: repairQuality.qualityScore,
                  validationReportJson: repairQuality.validationReportJson,
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
                qualityReport: repairQuality.readiness,
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
                renderLog: JSON.stringify(repairedArtifacts.renderLog),
                validationResults: JSON.stringify(revalidationResults),
                qualityScore: repairQuality.qualityScore,
                validationReportJson: repairQuality.validationReportJson,
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
              qualityReport: repairQuality.readiness,
            });
            await demoDelay();
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
        await demoDelay();
      } else {
        // Already tried max repairs — go to HUMAN_REVIEW
        await db.job.update({
          where: { id: jobId },
          data: {
            state: "HUMAN_REVIEW",
            validationResults: JSON.stringify(validationResults),
            qualityScore: validationQuality.qualityScore,
            validationReportJson: validationQuality.validationReportJson,
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
          qualityReport: validationQuality.readiness,
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
          qualityScore: validationQuality.qualityScore,
          validationReportJson: validationQuality.validationReportJson,
          reportPath: `/artifacts/${jobId}/report`,
          executionLogs: appendLog(
            (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
            "VALIDATED",
            (() => {
              const actionable = validationResults.filter(isValidationActionable);
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
        qualityReport: validationQuality.readiness,
      });
      await demoDelay();
    }

    currentStage = "deliver";
    sendEvent({
      state: "VALIDATED",
      step: "delivering",
      message: "Preparing final deliverables...",
    });
    await demoDelay();

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

    sendEvent({
      state: "DELIVERED",
      step: "delivered",
      message: "Job completed successfully! All deliverables are ready.",
      job: toPublicJobOrNull(finalJob),
    });
  } catch (error) {
    console.error("Error during job processing:", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    const errorState = currentStage === "render" ? "RENDER_FAILED"
      : currentStage === "validate" ? "VALIDATION_FAILED"
      : "GEOMETRY_FAILED";
    const modelError = error instanceof ModelRequestError ? error : null;
    const errorCode = modelError?.code
      ?? (currentStage === "render" ? "OPENSCAD_RENDER_FAILED"
        : currentStage === "validate" ? "CAD_VALIDATION_FAILED"
        : "CAD_GENERATION_FAILED");
    const retryable = modelError?.retryable ?? currentStage !== "validate";

    await db.job.update({
      where: { id: jobId },
      data: {
        state: errorState,
        executionLogs: appendLog(
          (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
          errorCode,
          `Processing failed during ${currentStage} [${errorCode}]: ${message}`
        ),
      },
    });

    sendEvent({
      state: errorState,
      step: "error",
      message: `Processing failed: ${message}`,
      errorCode,
      failureStage: currentStage,
      retryable,
    });
  }
}
