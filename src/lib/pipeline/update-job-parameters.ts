import type { Job } from "@prisma/client";
import type { CadValidationTargets } from "@/lib/harness/types";
import { claimJobExecution, JobExecutionConflict, JobExecutionStopped } from "./job-execution";
import { appendLog } from "@/lib/stores/job-store";
import { trackVersion } from "@/lib/version-tracker";
import { recordJobOutcomeSafe } from "@/lib/outcome/job-outcome";
import { writeScadParameters } from "@/lib/tools/scad-parameter-writer";
import { renderScadArtifacts, buildRenderFailureLog } from "@/lib/tools/scad-renderer";
import { clearValidationCache, validateRenderedArtifacts, getCriticalValidationFailures } from "@/lib/tools/validation-tool";
import { buildJobQuality } from "@/lib/validation/job-quality";

export class ParameterValidationError extends Error {
  constructor(public validationErrors: string[]) {
    super("Parameter validation failed");
  }
}

function parseJson<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) ?? fallback : fallback; } catch { return fallback; }
}

const EDITABLE_STATES = ["NEW", "CANCELLED", "DELIVERED", "HUMAN_REVIEW", "GEOMETRY_FAILED", "RENDER_FAILED", "VALIDATION_FAILED"];

export async function updateJobParameters(job: Job, parameters: Record<string, unknown>) {
  if (!EDITABLE_STATES.includes(job.state)) throw new JobExecutionConflict();
  const parsed = parseJson<Record<string, unknown> | Record<string, unknown>[]>(job.parameterSchema, []);
  const schema = Array.isArray(parsed) ? parsed : Array.isArray(parsed.parameters) ? parsed.parameters as Record<string, unknown>[] : [];
  const currentValues = parseJson<Record<string, unknown>>(job.parameterValues, {});
  const errors: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    const definition = schema.find((entry) => entry.key === key);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || (schema.length && !definition)) {
      errors.push(`Unknown parameter '${key}'`);
      continue;
    }
    if (definition?.editable === false) errors.push(`Parameter '${key}' is not editable`);
    const kind = String(definition?.kind ?? "");
    if (!["number", "string", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))) {
      errors.push(`Parameter '${key}' has an unsupported value`);
    }
    if (["number", "float", "integer"].includes(kind)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`Parameter '${key}' must be a finite number`);
        continue;
      }
      if (kind === "integer" && !Number.isInteger(value)) errors.push(`Parameter '${key}' must be an integer`);
      const min = definition?.min;
      const max = definition?.max;
      const step = definition?.step;
      if (typeof min === "number" && value < min) errors.push(`Parameter '${key}' is below minimum ${min}`);
      if (typeof max === "number" && value > max) errors.push(`Parameter '${key}' is above maximum ${max}`);
      if (typeof step === "number" && step > 0) {
        const offset = value - (typeof min === "number" ? min : 0);
        if (Math.abs(Math.round(offset / step) * step - offset) > 0.0001) errors.push(`Parameter '${key}' does not match step ${step}`);
      }
    }
    if (kind === "boolean" && typeof value !== "boolean") errors.push(`Parameter '${key}' must be boolean`);
    if (kind === "string" && typeof value !== "string") errors.push(`Parameter '${key}' must be a string`);
  }
  if (errors.length) throw new ParameterValidationError(errors);
  const values = { ...currentValues, ...parameters };
  const source = job.scadSource ? writeScadParameters(job.scadSource, values) : null;
  const execution = await claimJobExecution(job, "DEBUGGING");
  let stage: "save" | "render" | "validate" = "save";
  try {
    await execution.update({ data: {
      scadSource: source,
      parameterValues: JSON.stringify(values),
      // Schema values remain reset defaults; current values live in SCAD and parameterValues.
      parameterSchema: job.parameterSchema,
      stlPath: null, pngPath: null, renderLog: null, reportPath: null,
      validationResults: null, validationReportJson: null, qualityScore: null,
      visualRepairReportJson: null,
      executionLogs: appendLog(job.executionLogs, "PARAMETERS_UPDATED", `Updated parameters: ${Object.keys(parameters).join(", ")}`),
    } });
    await trackVersion(job.id, "parameters", job.parameterValues, JSON.stringify(values));
    await trackVersion(job.id, "scadSource", job.scadSource, source);
    // A user-authored parameter change is an outcome event: the first result was not
    // final. It is not a decision, so it never counts as success or failure.
    await recordJobOutcomeSafe({
      jobId: job.id,
      kind: "user_edited",
      source: "user",
      detail: { field: "parameters", keys: Object.keys(parameters) },
    });
    if (!source || job.state === "NEW" || job.state === "CANCELLED") {
      const updated = await execution.update({ data: { state: job.state } });
      return { job: updated, rendered: false, parameterValues: values };
    }
    stage = "render";
    const artifacts = await renderScadArtifacts(job.id, source, undefined, execution.assertActive);
    clearValidationCache();
    await execution.update({ data: {
      state: "RENDERED", stlPath: artifacts.stlPath, pngPath: artifacts.pngPath,
      renderLog: JSON.stringify(artifacts.renderLog),
    } });
    stage = "validate";
    await execution.assertActive();
    const results = await validateRenderedArtifacts({
      jobId: job.id, inputRequest: job.inputRequest, partFamily: job.partFamily,
      scadSource: source, stlFilePath: artifacts.stlFilePath, previewImagePath: artifacts.pngFilePath,
      wallThickness: typeof values.wall_thickness === "number" ? values.wall_thickness : 2,
      renderLog: artifacts.renderLog,
      validationTargets: parseJson<CadValidationTargets | undefined>(job.validationTargetsJson, undefined), skipVisual: true,
    });
    const state = getCriticalValidationFailures(results).length ? "HUMAN_REVIEW" : "DELIVERED";
    const quality = buildJobQuality({ state, scadSource: source, stlPath: artifacts.stlPath, pngPath: artifacts.pngPath, validationResults: results });
    const updated = await execution.update({ data: {
      state, validationResults: JSON.stringify(results), qualityScore: quality.qualityScore,
      validationReportJson: quality.validationReportJson,
      completedAt: state === "DELIVERED" ? new Date() : null,
    } });
    return { job: updated, rendered: true, parameterValues: values };
  } catch (error) {
    if (!(error instanceof JobExecutionStopped)) {
      try {
        await execution.update({ data: {
          state: stage === "validate" ? "VALIDATION_FAILED" : "GEOMETRY_FAILED",
          completedAt: null,
          ...(stage === "render" ? { stlPath: null, pngPath: null, renderLog: JSON.stringify(buildRenderFailureLog(0, [error instanceof Error ? error.message : "Parameter render failed"])) } : {}),
        } });
      } catch (recoveryError) {
        if (!(recoveryError instanceof JobExecutionStopped)) console.error("Parameter recovery failed", recoveryError);
      }
    }
    throw error;
  } finally {
    await execution.release();
  }
}
