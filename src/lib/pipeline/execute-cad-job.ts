import type { ExecutionProgress } from "./execution-progress";
import { usesOpenScadWasm } from "@/lib/tools/openscad-backend";
import { getOpenScadTimeoutMs, OPENSCAD_WASM_TIMEOUT_MS } from "@/lib/tools/scad-timeout";
import { db } from "@/lib/db";
import { MIMO_DEFAULT_MODEL } from "@/lib/mimo";
import { appendLog, parameterDefsToValues } from "@/lib/stores/job-store";
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
} from "@/lib/tools/scad-parameter-extractor";
import { buildScadParameterPersistence } from "@/lib/tools/scad-parameter-persistence";
import {
  detectPartFamily,
  generateMockScadCode,
  getParameterSchema,
  runScadGenerationSkill,
} from "@/lib/harness/skill-runner";
import { GeneratedScadCompileError } from "@/lib/harness/generation-errors";
import {
  buildRenderFailureLog,
  renderScadArtifacts,
  validateGeneratedScadSource,
} from "@/lib/tools/scad-renderer";
import { isRepairableScadCompileError } from "@/lib/tools/scad-compile-error";
import {
  isOpenScadCompileTimeoutError,
  isOpenScadTimeoutError,
} from "@/lib/tools/scad-timeout";
import {
  clearValidationCache,
  getCriticalValidationFailures,
  validateRenderedArtifacts,
} from "@/lib/tools/validation-tool";
import { runRepair } from "@/lib/repair/repair-controller";
import { deriveExpectedBBox, formatResearchEvidence, runRequestResearch } from "@/lib/research/request-research";
import type { ResearchResultV1 } from "@/lib/research/request-research";
import { buildJobQuality } from "@/lib/validation/job-quality";
import { isValidationActionable } from "@/lib/validation/evidence-status";
import { evaluateMotionContract } from "@/lib/validation/motion-contract";
import { toPublicJobOrNull } from "@/lib/public-job";
import { withLlmCallMeter, llmCallsThisRun } from "@/lib/model-runtime";
import { analyzeCadRequest } from "@/lib/intake/request-intelligence";
import { runModelCadIntake } from "@/lib/intake/model-intake";
import {
  applyResearchDisambiguation,
  resolveAmbiguityFromResearch,
} from "@/lib/intake/research-disambiguation";
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
import { randomUUID } from "crypto";
import { recordArtifactVersion } from "@/lib/artifacts/artifact-version";
import type { Prisma } from "@prisma/client";
import { JobExecutionStopped, type JobExecution } from "./job-execution";
import {
  buildGenerationPlan,
  generationPlanFingerprint,
  restoreGenerationPlan,
} from "@/lib/planning/generation-plan";

export type ProcessSseEvent = Record<string, unknown>;
export type ProcessEventSink = (data: ProcessSseEvent) => void;

export const STALE_REPAIR_LEASE_MS = 6 * 60_000;

interface CompileRepairLeaseEntry {
  type: "compile_repair_lease";
  token: string;
}

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

export function isStaleRepairLease(
  state: string,
  updatedAt: Date | string,
  repairHistory: string | null | undefined,
  now = Date.now(),
): boolean {
  const updatedAtMs = new Date(updatedAt).getTime();
  return state === "REPAIRING"
    && getCompileRepairLeaseEntry(repairHistory) !== null
    && Number.isFinite(updatedAtMs)
    && now - updatedAtMs >= STALE_REPAIR_LEASE_MS;
}

function parseRepairHistory(repairHistory: string | null | undefined): unknown[] {
  if (!repairHistory) return [];
  try {
    const parsed = JSON.parse(repairHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isCompileRepairLeaseEntry(value: unknown): value is CompileRepairLeaseEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompileRepairLeaseEntry>;
  return candidate.type === "compile_repair_lease"
    && typeof candidate.token === "string"
    && candidate.token.length > 0;
}

export function getCompileRepairLeaseEntry(
  repairHistory: string | null | undefined,
): CompileRepairLeaseEntry | null {
  const history = parseRepairHistory(repairHistory);
  const candidate = history.at(-1);
  return isCompileRepairLeaseEntry(candidate) ? candidate : null;
}

export function removeCompileRepairLease(
  repairHistory: string | null | undefined,
): string | null {
  const history = parseRepairHistory(repairHistory);
  if (!isCompileRepairLeaseEntry(history.at(-1))) return repairHistory ?? null;
  const restored = history.slice(0, -1);
  return restored.length > 0 ? JSON.stringify(restored) : null;
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
    status: "FAIL" as const,
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

/**
 * Entry point. Everything the run does — intake, research, generation, repair —
 * happens inside one LLM call-meter scope, so `Job.llmCallCount` sees every
 * call the run made.
 */
export function executeCadJob(
  jobId: string,
  sendRawEvent: ProcessEventSink,
  claimedExecution?: JobExecution
) {
  return withLlmCallMeter(() => runCadJob(jobId, sendRawEvent, claimedExecution));
}

async function runCadJob(
  jobId: string,
  sendRawEvent: ProcessEventSink,
  claimedExecution?: JobExecution
) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Job not found with id: ${jobId}`);
  }

  // Run-scoped clock. The LLM call counter is opened by `executeCadJob` above.
  const jobStartedAt = Date.now();
  // `llmCallCount` is cumulative across runs, so this run's calls are flushed
  // as a delta on top of whatever earlier runs already charged to this job.
  let llmCallsFlushed = 0;
  const executionAbort = new AbortController();
  let progress: ExecutionProgress = {
    step: "starting", message: "Starting CAD generation", startedAt: new Date().toISOString(),
    stageStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const sendEvent: ProcessEventSink = event => {
    if (typeof event.step === "string" && event.step !== progress.step) {
      progress = { step: event.step, message: String(event.message ?? ""), startedAt: progress.startedAt,
        stageStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        sourceBytes: progress.sourceBytes,
        ...(["compiling_scad", "rendering", "previewing"].includes(event.step) ? {
          backend: usesOpenScadWasm() ? "wasm" as const : "native" as const,
          timeoutMs: usesOpenScadWasm() ? OPENSCAD_WASM_TIMEOUT_MS : getOpenScadTimeoutMs(),
        } : {}),
      };
    }
    sendRawEvent({ ...event, executionProgress: progress });
  };
  const renderOptions = {
    signal: executionAbort.signal,
    onDiagnostic: (diagnostic: string) => { progress = { ...progress, diagnostic }; },
    onStage: (step: "rendering" | "previewing") => sendEvent({ step,
      message: step === "rendering" ? "Preparing STL geometry" : "Generating PNG preview from geometry" }),
  };
  let leaseCheckRunning = false;
  const leaseTimer = claimedExecution ? setInterval(async () => {
    if (leaseCheckRunning || executionAbort.signal.aborted) return;
    leaseCheckRunning = true;
    try {
      await claimedExecution.heartbeat({ ...progress, updatedAt: new Date().toISOString() });
      progress = { ...progress, updatedAt: new Date().toISOString() };
      sendRawEvent({ executionProgress: progress });
    }
    catch (error) {
      // Only a lost lease cancels the run; a transient database error must not.
      if (error instanceof JobExecutionStopped) executionAbort.abort(new JobExecutionStopped());
    }
    finally { leaseCheckRunning = false; }
  }, 1_000) : null;
  const assertExecution = async () => {
    if (executionAbort.signal.aborted) throw new JobExecutionStopped();
    await claimedExecution?.assertActive();
  };
  const updateJob = async (args: {
    where: { id: string };
    data: Prisma.JobUpdateManyMutationInput;
  }) => {
    await assertExecution();
    return claimedExecution
      ? claimedExecution.update({ data: args.data })
      : db.job.update(args);
  };
  const updateJobIf = async (args: {
    where: Prisma.JobWhereInput;
    data: Prisma.JobUpdateManyMutationInput;
  }): Promise<{ count: number }> => {
    await assertExecution();
    if (!claimedExecution) return db.job.updateMany(args);
    try {
      await claimedExecution.update(args);
      return { count: 1 };
    } catch (error) {
      if (error instanceof JobExecutionStopped) return { count: 0 };
      throw error;
    }
  };
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

    // Research runs before intake on purpose: a product page often settles what the
    // request means ("iPhone Duo" is a foldable), so the intake model should not have
    // to ask the user about something the web already answers. It stays advisory and
    // non-blocking: no backend or a dead network just records why.
    let requestResearch: ResearchResultV1 | null = null;
    currentStage = "research";
    try {
      requestResearch = await runRequestResearch({ request: inputRequest, model: job.modelId, signal: executionAbort.signal });
      const researched = requestResearch.status === "OK" || requestResearch.status === "PARTIAL";
      await updateJob({
        where: { id: jobId },
        data: {
          researchResult: JSON.stringify(requestResearch),
          executionLogs: appendLog(
            job.executionLogs,
            "RESEARCHED",
            researched
              ? `Web research via ${requestResearch.backend}: ${requestResearch.sources.length} source(s), ${requestResearch.dimensions.length} dimension(s)`
              : `Web research unavailable (${requestResearch.status}): ${requestResearch.notes}`,
          ),
        },
      });
      sendEvent({
        state: "NEW",
        step: "researched",
        message: researched
          ? `Web research found ${requestResearch.sources.length} source(s) for real-world dimensions.`
          : `Web research unavailable: ${requestResearch.notes}`,
        researchResult: requestResearch,
      });
    } catch (researchError) {
      const message = researchError instanceof Error ? researchError.message : "Unknown research error";
      console.warn(`CAD research stage failed; continuing without web evidence: ${message}`);
      sendEvent({
        state: "NEW",
        step: "research_degraded",
        message: "Web research failed; generation will use the request and stated assumptions only.",
      });
    }

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
        const modelIntelligence = await runModelCadIntake(
          inputRequest,
          job.modelId,
          formatResearchEvidence(requestResearch),
          executionAbort.signal,
        );
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

    // Deterministic backstop: if the intake model still asks for clarification but the
    // researched evidence names exactly one option, take that option instead of asking.
    const researchResolution = resolveAmbiguityFromResearch(requestIntelligence, requestResearch);
    if (researchResolution) {
      requestIntelligence = applyResearchDisambiguation(requestIntelligence, researchResolution);
      sendEvent({
        state: "NEW",
        step: "intent_resolved_by_research",
        message: `Clarification answered by web research: ${researchResolution.interpretation.label}`,
        researchResolution: {
          interpretation_id: researchResolution.interpretation.id,
          matched: researchResolution.decisiveTokens,
          evidence: researchResolution.evidenceQuote,
        },
      });
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

      await updateJob({
        where: { id: jobId },
        data: {
          state: "HUMAN_REVIEW",
          partFamily: null,
          builderName: null,
          generationPath: "intent_clarification",
          intentResult: JSON.stringify(requestIntelligence),
          cadIntentJson: JSON.stringify({ request_intelligence: requestIntelligence }),
          // What is in question here is the *meaning* of the request, so any
          // targets an earlier run derived belong to the interpretation the user
          // is about to reject. Left in place they would validate the new part
          // against the wrong part's dimensions — and a PASS against the wrong
          // target is worse than a skip. Contrast the repair branches below,
          // which keep their targets: there the design intent has not changed.
          validationTargetsJson: null,
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

    const parameterSchema = await getParameterSchema(partFamily, paramValues);
    const planFingerprint = generationPlanFingerprint(
      inputRequest,
      partFamily,
      paramValues,
      requestIntelligence,
    );
    let generationPlanCheckpoint = restoreGenerationPlan(job.cadIntentJson, planFingerprint);
    let generationExecutionLogs = job.executionLogs;

    if (generationPlanCheckpoint) {
      sendEvent({
        state: "NEW",
        step: "planning_reused",
        message: "Reusing the persisted geometry plan; resuming directly at SCAD coding...",
      });
    } else {
      currentStage = "plan";
      sendEvent({
        state: "NEW",
        step: "planning_geometry",
        message: "Creating a compact geometry contract for the SCAD coding stage...",
      });
      generationPlanCheckpoint = buildGenerationPlan({
        request: inputRequest,
        family: partFamily,
        parameterValues: paramValues,
        parameterSchema,
        intelligence: requestIntelligence,
      });
      generationExecutionLogs = appendLog(
        job.executionLogs,
        "CAD_PLANNED",
        `Persisted generation plan ${generationPlanCheckpoint.fingerprint.slice(0, 12)} for ${partFamily}`,
      );
      await updateJob({
        where: { id: jobId },
        data: {
          generationPath: "structured_plan_ready",
          cadIntentJson: JSON.stringify({
            request_intelligence: requestIntelligence,
            generation_plan: generationPlanCheckpoint,
          }),
          modelingPlanJson: JSON.stringify(generationPlanCheckpoint.plan.modeling_plan),
          validationTargetsJson: JSON.stringify(generationPlanCheckpoint.plan.validation_targets),
          intentResult: JSON.stringify(requestIntelligence),
          executionLogs: generationExecutionLogs,
        },
      });
      sendEvent({
        state: "NEW",
        step: "geometry_planned",
        message: "Geometry plan persisted. Starting the focused SCAD coding stage...",
        planFingerprint: generationPlanCheckpoint.fingerprint,
      });
    }

    let generationResult: StructuredGenerationResult;
    let usedLLM = false;
    let compileRepairClaimed = false;
    let compileRepairLease: string | null = null;
    let compileRepairPreviousHistory: string | null = job.repairHistory;

    try {
      currentStage = "generate";
      generationExecutionLogs = appendLog(generationExecutionLogs, "SCAD_GENERATION_STARTED",
        `Writing OpenSCAD with ${job.modelId || "configured default model"}`);
      await updateJob({ where: { id: jobId }, data: { executionLogs: generationExecutionLogs } });
      sendEvent({
        state: "NEW",
        step: "generating_llm",
        executionLogs: generationExecutionLogs,
        message: `Generating SCAD code via ${job.modelId || process.env.MIMO_MODEL || MIMO_DEFAULT_MODEL}...`,
      });
      generationResult = await runScadGenerationSkill(
        generationRequest,
        paramValues,
        job.modelId,
        partFamily,
        generationPlanCheckpoint.plan,
        executionAbort.signal,
        formatResearchEvidence(requestResearch),
        async prepared => {
          // Durable checkpoint BEFORE entering a potentially long compile.
          progress.sourceBytes = Buffer.byteLength(prepared.scad_source);
          generationExecutionLogs = appendLog(generationExecutionLogs, "SCAD_SOURCE_READY",
            "Model output saved; starting OpenSCAD compile validation");
          await updateJob({ where: { id: jobId }, data: {
            scadSource: prepared.scad_source,
            parameterSchema: JSON.stringify(prepared.parameters),
            parameterValues: JSON.stringify(parameterDefsToValues(prepared.parameters)),
            executionLogs: generationExecutionLogs,
          } });
          sendEvent({ step: "compiling_scad", message: "Source saved. OpenSCAD is compiling the geometry; completion percentage is unavailable.",
            scadSource: prepared.scad_source, executionLogs: generationExecutionLogs });
          await claimedExecution?.heartbeat(progress);
        },
        renderOptions.onDiagnostic,
      );
      usedLLM = true;
    } catch (llmError) {
      await assertExecution();
      if (llmError instanceof GeneratedScadCompileError) {
        currentStage = "repair";
        // A budget timeout is a complexity failure: keep the generated source and
        // run one simplification repair instead of a generic syntax repair.
        const compileBudgetError = isOpenScadCompileTimeoutError(llmError.cause)
          ? llmError.cause
          : null;
        const compileBudgetSeconds = compileBudgetError
          ? Math.max(1, Math.round(compileBudgetError.timeoutMs / 1000))
          : 0;
        const compileFailure = compileFailureResult(llmError.compileLog);
        let failedScad = llmError.generationResult.scad_source;
        const failedParameters = mergeExtractedParameters(
          extractParameterDefsFromScad(failedScad),
          llmError.generationResult.parameters,
        );
        const generatedCadIntent = JSON.stringify({
          request_intelligence: requestIntelligence,
          generation_plan: generationPlanCheckpoint,
          part_type: llmError.generationResult.part_type,
          summary: llmError.generationResult.summary,
          units: llmError.generationResult.units,
          features: llmError.generationResult.features,
          constraints: llmError.generationResult.constraints,
          design_rationale: llmError.generationResult.design_rationale,
          instruction_fingerprint: llmError.generationResult.instruction_fingerprint,
          model_execution: llmError.generationResult.model_execution,
        });

        if (!compileBudgetError && !isRepairableScadCompileError(llmError.cause)) {
          await updateJob({ where: { id: jobId }, data: {
            state: "HUMAN_REVIEW",
            scadSource: failedScad,
            parameterSchema: JSON.stringify(failedParameters),
            parameterValues: JSON.stringify(parameterDefsToValues(failedParameters)),
            cadIntentJson: generatedCadIntent,
            modelingPlanJson: JSON.stringify(llmError.generationResult.modeling_plan),
            validationTargetsJson: JSON.stringify(llmError.generationResult.validation_targets),
            stlPath: null, pngPath: null, renderLog: null, reportPath: null,
            validationReportJson: null, qualityScore: null, completedAt: null,
            validationResults: JSON.stringify([{ ...compileFailure, status: "ERROR" }]),
            executionLogs: appendLog(generationExecutionLogs, "OPENSCAD_RUNTIME_UNAVAILABLE", llmError.compileLog),
          } });
          sendEvent({ state: "HUMAN_REVIEW", step: "error", errorCode: "OPENSCAD_RUNTIME_UNAVAILABLE",
            failureStage: "generate", retryable: true,
            message: `OpenSCAD validation was unavailable. Generated source is preserved; retry after restoring the runtime. ${llmError.compileLog}` });
          return;
        }
        compileRepairPreviousHistory = JSON.stringify([
          ...parseRepairHistory(job.repairHistory),
          { type: "rejected_generation", scadSource: failedScad, diagnostics: llmError.compileLog },
        ]);

        generationExecutionLogs = appendLog(
          generationExecutionLogs,
          "REPAIRING",
          compileBudgetError
            ? `Generated SCAD exceeded the ${compileBudgetSeconds}s OpenSCAD compile budget; starting one complexity-reduction repair`
            : "Generated SCAD failed compilation; starting one compiler-guided repair",
        );
        const repairLeaseEntry: CompileRepairLeaseEntry = {
          type: "compile_repair_lease",
          token: randomUUID(),
        };
        const repairLease = JSON.stringify([
          ...parseRepairHistory(compileRepairPreviousHistory),
          repairLeaseEntry,
        ]);
        compileRepairLease = repairLease;
        const claim = await updateJobIf({
          where: { id: jobId, state: job.state },
          data: {
            state: "REPAIRING",
            scadSource: failedScad,
            parameterSchema: JSON.stringify(failedParameters),
            parameterValues: JSON.stringify(parameterDefsToValues(failedParameters)),
            cadIntentJson: generatedCadIntent,
            modelingPlanJson: JSON.stringify(llmError.generationResult.modeling_plan),
            validationTargetsJson: JSON.stringify(llmError.generationResult.validation_targets),
            researchResult: requestResearch ? JSON.stringify(requestResearch) : null,
            designResult: null,
            repairHistory: repairLease,
            stlPath: null,
            pngPath: null,
            renderLog: null,
            reportPath: null,
            validationResults: JSON.stringify([compileFailure]),
            visualRepairReportJson: null,
            validationReportJson: null,
            qualityScore: null,
            completedAt: null,
            executionLogs: generationExecutionLogs,
          },
        });
        if (claim.count !== 1) {
          sendEvent({
            state: "REPAIRING",
            step: "repair_error",
            message: "Compile repair was not started because the job state changed.",
            errorCode: "JOB_STATE_CHANGED",
            retryable: true,
          });
          return;
        }
        compileRepairClaimed = true;

        sendEvent({
          state: "NEW",
          step: "repairing",
          message: compileBudgetError
            ? `Generated SCAD is too complex to compile within the OpenSCAD ${compileBudgetSeconds}s budget. Attempting one complexity-reduction repair...`
            : "Generated SCAD failed OpenSCAD compilation. Attempting one geometry repair using the compiler diagnostics...",
          errorCode: compileBudgetError ? "OPENSCAD_COMPILE_TIMEOUT" : "OPENSCAD_COMPILE_FAILED",
        });

        let repairValidationStarted = false;
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
            signal: executionAbort.signal,
            repairStrategy: compileBudgetError ? "simplify" : "compile",
          });
          failedScad = repairResult.generationResult.scad_source;
          repairValidationStarted = true;
          await updateJob({ where: { id: jobId }, data: { scadSource: failedScad } });
          sendEvent({ step: "compiling_scad", message: "Compiling the saved repaired source" });
          await validateGeneratedScadSource(failedScad, renderOptions);
          const repairedParameters = mergeExtractedParameters(
            extractParameterDefsFromScad(failedScad),
            repairResult.generationResult.parameters.length > 0
              ? repairResult.generationResult.parameters
              : llmError.generationResult.parameters,
          );
          generationResult = {
            ...llmError.generationResult,
            ...repairResult.generationResult,
            parameters: repairedParameters,
            scad_source: failedScad,
          };
          usedLLM = true;
          currentStage = "generate";
          sendEvent({
            state: "NEW",
            step: "repair_success",
            message: "The generated SCAD was repaired and passed OpenSCAD compilation.",
          });
        } catch (repairError) {
          await assertExecution();
          const repairMessage = repairError instanceof Error
            ? repairError.message
            : "Unknown compile repair error";
          const providerError = repairError instanceof ModelRequestError ? repairError : null;
          const repairedBudgetError = isOpenScadCompileTimeoutError(repairError)
            ? repairError
            : null;
          const repairedBudgetSeconds = repairedBudgetError
            ? Math.max(1, Math.round(repairedBudgetError.timeoutMs / 1000))
            : 0;
          const repairValidationWasOperational = repairValidationStarted
            && !providerError
            && !repairedBudgetError
            && !isRepairableScadCompileError(repairError);
          const repairWasCompileFailure = !providerError
            && !repairValidationWasOperational
            && repairValidationStarted;
          const failureSummary = providerError
            ? "Generated SCAD failed compilation and the repair model was unavailable"
            : repairedBudgetError
              ? `The automatic complexity-reduction repair still exceeded the ${repairedBudgetSeconds}s OpenSCAD compile budget`
            : repairValidationWasOperational
              ? "The repaired SCAD was preserved because OpenSCAD validation was unavailable"
            : repairWasCompileFailure
              ? "The automatic repair still failed OpenSCAD compilation"
              : "Generated SCAD failed compilation and automatic repair could not complete";
          const validationResults = repairWasCompileFailure
            ? [compileFailureResult(
                repairedBudgetError
                  ? `Automatic repair still exceeded the OpenSCAD compile budget: ${repairMessage}`
                  : `Automatic repair still failed OpenSCAD compilation: ${repairMessage}`,
              )]
            : [compileFailure];
          const errorCode = providerError?.code
            ?? (repairValidationWasOperational ? "OPENSCAD_RUNTIME_UNAVAILABLE"
              : (repairedBudgetError || (!repairValidationStarted && compileBudgetError)) ? "OPENSCAD_COMPILE_TIMEOUT"
              : "OPENSCAD_COMPILE_FAILED");
          const persistedParameters = mergeExtractedParameters(
            extractParameterDefsFromScad(failedScad),
            llmError.generationResult.parameters,
          );
          const quality = buildJobQuality({
            state: "HUMAN_REVIEW",
            scadSource: failedScad,
            stlPath: null,
            pngPath: null,
            validationResults,
          });

          const committed = await updateJobIf({
            where: { id: jobId, state: "REPAIRING", repairHistory: repairLease },
            data: {
              state: "HUMAN_REVIEW",
              partFamily,
              builderName: "AgentSCAD-LLM-compile-repair",
              generationPath: "llm_compile_repair_failed",
              scadSource: failedScad,
              parameterSchema: JSON.stringify(persistedParameters),
              parameterValues: JSON.stringify(parameterDefsToValues(persistedParameters)),
              stlPath: null,
              pngPath: null,
              reportPath: null,
              renderLog: JSON.stringify(buildRenderFailureLog(0, [repairMessage])),
              validationResults: JSON.stringify(validationResults),
              visualRepairReportJson: null,
              qualityScore: quality.qualityScore,
              validationReportJson: quality.validationReportJson,
              completedAt: null,
              repairHistory: compileRepairPreviousHistory,
              executionLogs: appendLog(
                generationExecutionLogs,
                errorCode,
                `${failureSummary}: ${repairMessage}`,
              ),
            },
          });
          if (committed.count !== 1) return;
          sendEvent({
            state: "HUMAN_REVIEW",
            step: "repair_error",
            message: `${failureSummary}. The latest source is preserved for review.${repairedBudgetError ? ` ${repairMessage}` : compileBudgetError ? ` ${compileBudgetError.message}` : ""}`,
            errorCode,
            failureStage: providerError ? "repair" : "generate",
            retryable: providerError?.retryable ?? true,
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

    // Research gives us the real envelope; use it as the bbox target so B001 checks
    // the model against a sourced size instead of skipping every time.
    const researchedBBox = deriveExpectedBBox(requestResearch);
    if (researchedBBox && (generationResult.validation_targets?.expected_bbox ?? []).length < 3) {
      generationResult.validation_targets = {
        ...generationResult.validation_targets,
        expected_bbox: researchedBBox,
      };
      sendEvent({
        state: "NEW",
        step: "research_bbox_target",
        message: `Bounding-box target set from research: [${researchedBBox.join(", ")}] mm`,
      });
    }

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

    const generatedParameterPersistence = buildScadParameterPersistence(
      scadCode,
      generationResult.parameters,
    );

    const generatedData = {
        state: "SCAD_GENERATED",
        partFamily,
        scadSource: scadCode,
        stlPath: null,
        pngPath: null,
        renderLog: null,
        builderName,
        generationPath,
        parameterSchema: generatedParameterPersistence.parameterSchema,
        parameterValues: generatedParameterPersistence.parameterValues,
        cadIntentJson: JSON.stringify({
          request_intelligence: requestIntelligence,
          generation_plan: generationPlanCheckpoint,
          part_type: generationResult.part_type,
          summary: generationResult.summary,
          units: generationResult.units,
          features: generationResult.features,
          constraints: generationResult.constraints,
          design_rationale: generationResult.design_rationale,
          instruction_fingerprint: generationResult.instruction_fingerprint,
          model_execution: generationResult.model_execution,
        }),
        modelingPlanJson: JSON.stringify(generationResult.modeling_plan),
        validationTargetsJson: JSON.stringify(generationResult.validation_targets),
        researchResult: JSON.stringify({
          part_family: partFamily,
          generation_method: usedLLM ? "llm" : "template",
          summary: generationResult.summary,
          research_status: requestResearch?.status ?? "DISABLED",
          research_backend: requestResearch?.backend ?? null,
          references_found: requestResearch?.sources.length ?? 0,
          research_sources: requestResearch?.sources ?? [],
          research_evidence: requestResearch?.evidence ?? [],
          research_notes: requestResearch?.notes ?? "",
          similar_designs: usedLLM ? [] : ["standard_box_enclosure_v1", "parametric_case_v2"],
          best_practices: [],
        }),
        // Keep the approved intake at the top level so a later re-process can
        // restore the user's choice without another clarification/model call.
        // Generated geometry metadata already lives in cadIntentJson above.
        intentResult: JSON.stringify(requestIntelligence),
        designResult: JSON.stringify({
          approach: generationPath,
          orchestration: "planned_code_validate_repair_v1",
          plan_fingerprint: generationPlanCheckpoint.fingerprint,
          instruction_fingerprint: generationResult.instruction_fingerprint ?? null,
          model_id: generationResult.model_execution?.model ?? job.modelId ?? process.env.MIMO_MODEL ?? MIMO_DEFAULT_MODEL,
          provider: generationResult.model_execution?.provider ?? null,
          usage: generationResult.model_execution?.usage ?? null,
          parameters_mapped: generationResult.parameters.map((p) => p.key),
          llm_used: usedLLM,
        }),
        repairHistory: compileRepairClaimed ? compileRepairPreviousHistory : job.repairHistory,
        executionLogs: appendLog(
          generationExecutionLogs,
          "SCAD_GENERATED",
          `SCAD code generated via ${usedLLM ? "LLM" : "template"} (family: ${partFamily})`
        ),
      };
    if (compileRepairClaimed) {
      const committed = await updateJobIf({
        where: { id: jobId, state: "REPAIRING", repairHistory: compileRepairLease },
        data: generatedData,
      });
      if (committed.count !== 1) return;
    } else {
      await updateJob({ where: { id: jobId }, data: generatedData });
    }

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

      renderedArtifacts = await renderScadArtifacts(jobId, scadCode, undefined, assertExecution, renderOptions);
      clearValidationCache();
    } catch (execError) {
      await assertExecution();
      const renderError =
        execError instanceof Error ? execError.message : "Unknown OpenSCAD render error";
      const renderErrorCode = isOpenScadTimeoutError(execError) ? "OPENSCAD_RENDER_TIMEOUT" : "OPENSCAD_RENDER_FAILED";
      warnings.push(`OpenSCAD rendering failed: ${renderError}`);

      console.warn("OpenSCAD rendering failed:", execError);
      const quality = buildJobQuality({
        state: "GEOMETRY_FAILED",
        scadSource: scadCode,
        stlPath: null,
        pngPath: null,
        validationResults: [],
      });

      await updateJob({
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
            renderErrorCode,
            `OpenSCAD render failed: ${renderError}`
          ),
        },
      });

      sendEvent({
        state: "GEOMETRY_FAILED",
        step: "render_failed",
        message: `OpenSCAD render failed. Source is preserved. ${renderError}`,
        errorCode: renderErrorCode,
        failureStage: "render",
        retryable: true,
        error: renderError,
        qualityReport: quality.readiness,
      });
      return;
    }

    if (!renderedArtifacts) {
      throw new Error("OpenSCAD render did not return artifact paths");
    }
    let finalArtifacts = renderedArtifacts;

    await updateJob({
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
    const motionContractResult = evaluateMotionContract({
      inputRequest,
      intentResult: requestIntelligence,
      scadSource: scadCode,
    });
    if (motionContractResult) validationResults.push(motionContractResult);
    let finalValidationResults = validationResults;
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

        await updateJob({
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
          await updateJob({ where: { id: jobId }, data: { retryCount: { increment: 1 } } });

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
            signal: executionAbort.signal,
          });

          const repairedScad = repairResult.generationResult.scad_source;
          // The repair can replace the artifact wholesale; refresh the editable
          // parameter contract from the repaired source before persisting it.
          const repairedParameterPersistence = buildScadParameterPersistence(
            repairedScad,
            repairResult.generationResult.parameters,
          );
          generationResult = {
            ...generationResult,
            scad_source: repairedScad,
            parameters: repairedParameterPersistence.parameters,
          };

          sendEvent({
            state: "REPAIRING",
            step: "repair_rendering",
            message: `Repair applied: ${repairResult.repairMeta.repair_summary}. Re-rendering...`,
          });

          // Re-render with repaired SCAD
          let repairedArtifacts: RenderedArtifacts | null = null;
          try {
            clearValidationCache();
            // Compile first: a repaired source that does not even parse used to be
            // persisted and only failed later inside the renderer, which parked the
            // job in HUMAN_REVIEW with a syntax-error artifact.
            await validateGeneratedScadSource(repairedScad, renderOptions);
            repairedArtifacts = await renderScadArtifacts(jobId, repairedScad, undefined, assertExecution, renderOptions);
          } catch (reRenderError) {
            await assertExecution();
            const msg = reRenderError instanceof Error ? reRenderError.message : "Unknown";
            await updateJob({
              where: { id: jobId },
              data: {
                state: "HUMAN_REVIEW",
                scadSource: repairedScad,
                parameterSchema: repairedParameterPersistence.parameterSchema,
                parameterValues: repairedParameterPersistence.parameterValues,
                stlPath: null,
                pngPath: null,
                renderLog: JSON.stringify(buildRenderFailureLog(0, [msg])),
                executionLogs: appendLog(
                  (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
                  "HUMAN_REVIEW",
                  `Repair SCAD failed OpenSCAD compile or render: ${msg}`
                ),
              },
            });
            sendEvent({
              state: "HUMAN_REVIEW",
              step: "repair_render_failed",
              errorCode: isOpenScadTimeoutError(reRenderError)
                ? (reRenderError.stage === "validation" ? "OPENSCAD_COMPILE_TIMEOUT" : "OPENSCAD_RENDER_TIMEOUT")
                : "OPENSCAD_RENDER_FAILED",
              failureStage: "repair",
              retryable: true,
              message: `Repair SCAD failed OpenSCAD compile or render: ${msg}`,
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
            const repairedMotionContract = evaluateMotionContract({
              inputRequest,
              intentResult: requestIntelligence,
              scadSource: repairedScad,
            });
            if (repairedMotionContract) revalidationResults.push(repairedMotionContract);
            const stillFailing = getCriticalValidationFailures(revalidationResults);
            const repairQuality = buildJobQuality({
              state: stillFailing.length > 0 ? "HUMAN_REVIEW" : "DELIVERED",
              scadSource: repairedScad,
              stlPath: repairedArtifacts.stlPath,
              pngPath: repairedArtifacts.pngPath,
              validationResults: revalidationResults,
            });

            if (stillFailing.length > 0) {
              await recordArtifactVersion({
                jobId, scadSource: repairedScad, artifacts: repairedArtifacts,
                validationResults: revalidationResults,
                instructionFingerprint: repairResult.repairMeta.instruction_fingerprint ?? null,
                modelExecution: repairResult.repairMeta.model_execution ?? null,
              });
              await updateJob({
                where: { id: jobId },
                data: {
                  state: "HUMAN_REVIEW",
                  scadSource: repairedScad,
                  parameterSchema: repairedParameterPersistence.parameterSchema,
                  parameterValues: repairedParameterPersistence.parameterValues,
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
            finalArtifacts = repairedArtifacts;
            finalValidationResults = revalidationResults;
            await updateJob({
              where: { id: jobId },
              data: {
                scadSource: repairedScad,
                parameterSchema: repairedParameterPersistence.parameterSchema,
                parameterValues: repairedParameterPersistence.parameterValues,
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
          await updateJob({
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
        await recordArtifactVersion({
          jobId, scadSource: scadCode, artifacts: renderedArtifacts,
          validationResults,
          instructionFingerprint: generationResult.instruction_fingerprint,
          modelExecution: generationResult.model_execution,
        });
        await updateJob({
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
      await updateJob({
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

    await assertExecution();
    await recordArtifactVersion({
      jobId, scadSource: scadCode, artifacts: finalArtifacts,
      validationResults: finalValidationResults,
      instructionFingerprint: generationResult.instruction_fingerprint,
      modelExecution: generationResult.model_execution,
    });
    await updateJob({
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
    if (error instanceof JobExecutionStopped || executionAbort.signal.aborted) {
      sendRawEvent({ step: "cancelled", message: "Execution stopped. Saved source is preserved." });
      return;
    }
    console.error("Error during job processing:", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    const errorState = currentStage === "render" ? "RENDER_FAILED"
      : currentStage === "validate" ? "VALIDATION_FAILED"
      : "GEOMETRY_FAILED";
    const modelError = error instanceof ModelRequestError ? error : null;
    const timeoutError = isOpenScadTimeoutError(error) ? error : null;
    const errorCode = modelError?.code
      ?? (timeoutError
        ? (timeoutError.stage === "validation" ? "OPENSCAD_COMPILE_TIMEOUT" : "OPENSCAD_RENDER_TIMEOUT")
        : currentStage === "render" ? "OPENSCAD_RENDER_FAILED"
        : currentStage === "validate" ? "CAD_VALIDATION_FAILED"
        : "CAD_GENERATION_FAILED");
    const retryable = timeoutError
      ? true
      : (modelError?.retryable ?? currentStage !== "validate");

    let detailedLog = `Processing failed during ${currentStage} [${errorCode}]: ${message}`;
    if (modelError?.evidence) {
      const parts: string[] = [];
      if (modelError.evidence.provider) parts.push(`provider: ${modelError.evidence.provider}`);
      if (modelError.evidence.transportCode) parts.push(`transport: ${modelError.evidence.transportCode}`);
      if (typeof modelError.evidence.elapsedMs === "number") parts.push(`request duration: ${Math.round(modelError.evidence.elapsedMs / 1000)}s`);
      if (modelError.evidence.model) parts.push(`model: ${modelError.evidence.model}`);
      if (modelError.evidence.finishReason) parts.push(`finish_reason: ${modelError.evidence.finishReason}`);
      if (typeof modelError.evidence.responseLength === "number") parts.push(`length: ${modelError.evidence.responseLength}`);
      if (parts.length > 0) detailedLog += ` (${parts.join(", ")})`;
      if (modelError.evidence.rawSnippet) {
        detailedLog += `\nRaw response preview:\n${modelError.evidence.rawSnippet}`;
      }
    }

    const executionLogs = appendLog(
      (await db.job.findUnique({ where: { id: jobId } }))?.executionLogs,
      errorCode, detailedLog,
    );
    await updateJob({
      where: { id: jobId },
      data: { state: errorState, executionLogs },
    });

    sendEvent({
      state: errorState,
      step: "error",
      message: `Processing failed: ${message}`,
      errorCode,
      failureStage: currentStage,
      executionLogs,
      retryable,
      ...(modelError?.evidence ? { evidence: modelError.evidence } : {}),
    });
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    // Single write point for run metrics.
    //
    // `latencyMs` means "wall-clock time from the start of this run to the
    // state the run ended in". It is written here and only here: the previous
    // write site sat inside the SCAD_GENERATED transition, so it stopped the
    // clock before render / validate / repair — a 296s job recorded 26.6s.
    // Writing it in `finally` also means any newly added run-ending state is
    // measured automatically instead of silently going unrecorded.
    //
    // `llmCallCount` is flushed as a delta so a concurrent run's calls are
    // never overwritten, and it is flushed even when the run was cancelled,
    // because the calls happened and cost the same either way.
    const llmCallDelta = llmCallsThisRun() - llmCallsFlushed;
    if (llmCallDelta > 0 || !executionAbort.signal.aborted) {
      try {
        const written = await db.job.updateMany({
          where: { id: jobId },
          data: {
            ...(llmCallDelta > 0 ? { llmCallCount: { increment: llmCallDelta } } : {}),
            ...(executionAbort.signal.aborted ? {} : { latencyMs: Date.now() - jobStartedAt }),
          },
        });
        if (written.count === 1) llmCallsFlushed += llmCallDelta;
      } catch (metricError) {
        // A missing metric must never take the run down with it.
        console.error("Failed to record terminal run metrics:", metricError);
      }
    }
  }
}
