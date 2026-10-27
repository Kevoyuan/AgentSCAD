// ---------------------------------------------------------------------------
// Repair Controller — orchestrates validation-driven LLM repair
//
// Used by the pipeline and the repair API route. Takes the failed job context,
// builds a repair prompt from the scad-repair skill, calls the LLM once,
// and returns the repaired result.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { loadSkill, skillInstructions } from "@/lib/skill-resolver";
import { buildScadLibraryPrompt } from "@/lib/tools/scad-library-resolver";
import {
  createChatCompletionDetailed,
  type ModelCompletionResponse,
} from "@/lib/tools/model-router";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
} from "@/lib/tools/scad-parameter-extractor";
import { normalizeGenerationResult } from "@/lib/harness/structured-output";
import { ModelRequestError, type ModelErrorEvidence } from "@/lib/model-runtime";
import type { StructuredGenerationResult, CadValidationTargets } from "@/lib/harness/types";
import type { ValidationResult } from "@/lib/mesh-validator";
import { getValidationEvidenceStatus } from "@/lib/validation/evidence-status";

export interface RepairInput {
  originalRequest: string;
  partFamily: string;
  currentScadCode: string;
  validationResults: ValidationResult[];
  cadIntent?: {
    part_type?: string;
    features?: unknown[];
    constraints?: unknown;
    modeling_plan?: string[];
    validation_targets?: CadValidationTargets;
  };
  requestedModel?: string | null;
  signal?: AbortSignal;
  /**
   * "simplify" is selected when the generated source was rejected by the compile
   * budget instead of by a source/geometry diagnostic. The repair then trades
   * small or hidden detail for a source that OpenSCAD can compile in budget.
   */
  repairStrategy?: "compile" | "simplify";
}

export interface RepairResult {
  scad_source: string;
  repair_summary: string;
  risk: "low" | "medium" | "high";
  requires_rerender: boolean;
  assumptions: string[];
  instruction_fingerprint?: string;
  model_execution?: { model: string; provider: string; usage?: ModelErrorEvidence["usage"]; latency_ms: number };
}

function emptyStructuredDefaults() {
  return {
    part_type: "unknown",
    units: "mm",
    features: [],
    constraints: {
      dimensions: {},
      assumptions: [],
      manufacturing: {},
      geometry: {},
      code: {},
    },
    modeling_plan: [],
    design_rationale: [],
    validation_targets: {
      expected_bbox: [],
      required_feature_checks: [],
      forbidden_failure_modes: [],
    },
  };
}

export function buildRepairPrompt(input: RepairInput): string {
  const failedRules = input.validationResults
    .filter((r) => getValidationEvidenceStatus(r) === "FAIL")
    .map((r) => `- ${r.rule_id} ${r.rule_name} (${r.is_critical ? "CRITICAL" : "non-critical"}): ${r.message}`)
    .join("\n");

  const passedRules = input.validationResults
    .filter((r) => ["PASS", "WARN"].includes(getValidationEvidenceStatus(r)))
    .map((r) => `- ${getValidationEvidenceStatus(r)} ${r.rule_id} ${r.rule_name}: ${r.message}`)
    .join("\n");

  const unavailableRules = input.validationResults
    .filter((r) => ["SKIP", "ERROR", "NOT_RUN"].includes(getValidationEvidenceStatus(r)))
    .map((r) => `- ${getValidationEvidenceStatus(r)} ${r.rule_id} ${r.rule_name}: ${r.message}`)
    .join("\n");

  const intentBlock = input.cadIntent
    ? [
        `Part type: ${input.cadIntent.part_type || "unknown"}`,
        `Features: ${JSON.stringify(input.cadIntent.features || [])}`,
        `Constraints: ${JSON.stringify(input.cadIntent.constraints || {})}`,
        `Modeling plan: ${JSON.stringify(input.cadIntent.modeling_plan || [])}`,
        `Validation targets: ${JSON.stringify(input.cadIntent.validation_targets || {})}`,
      ].join("\n")
    : "No structured intent available (v1.x format)";

  return [
    "## Original Request",
    input.originalRequest,
    "",
    "## Part Family",
    input.partFamily,
    "",
    "## CAD Intent (from generation)",
    intentBlock,
    "",
    "## Current SCAD Code",
    "```scad",
    input.currentScadCode,
    "```",
    "",
    "## Validation Results",
    "### Failed Rules",
    failedRules || "(none — all passed)",
    "",
    "### Passing and Warning Rules",
    passedRules || "(none)",
    "",
    "### Unavailable or Unexecuted Rules",
    unavailableRules || "(none)",
    "These statuses are uncertainty, not evidence of a geometry defect. Do not repair them as failed checks.",
    "",
    "## Repair Goal",
    ...(input.repairStrategy === "simplify"
      ? [
          "The current source exceeded the compile budget; its syntax and geometry are not yet verified: OpenSCAD exhausted its compile budget before finishing.",
          "This is a COMPLEXITY failure, not a syntax or geometry-correctness failure.",
          "Rewrite the source to compile comfortably within budget while preserving the user's requested form:",
          "- Keep the outer silhouette, all required dimensions, functional features, fitting surfaces, and every editable top-level parameter.",
          "- Merge or drop optional internal and hidden detail; preserve functional interfaces and clearances.",
          "- Reduce repeated hull()/minkowski()/dense-array geometry; prefer a few coarse primitives.",
          "- Use a coarse global resolution: set `$fa = 12;` and `$fs = 2;`, and avoid per-feature `$fn` above 32 unless the request needs it.",
          "- Keep the final boolean tree to roughly 40-60 operations; do not model detail below the requested fidelity.",
          "- Keep all geometry in one `module generated_part()` called once at the top level.",
          "Target a source that compiles in well under half of the configured budget.",
        ]
      : [
          "Fix ONLY the failed validation checks listed above.",
          "Do NOT change dimensions or features that already pass validation.",
          "Preserve all required features from the CAD intent.",
          "Use AgentSCAD standard library modules (include <agentscad_std.scad>) when possible.",
          "Keep parameters as top-level assignments.",
        ]),
    "",
    "Return the full corrected structured JSON with updated scad_source:",
    '{"part_type": "...", "features": [...], "modeling_plan": [...], "scad_source": "..."}',
    "",
    "Output the JSON object first, then a blank line, then the SCAD code in a markdown fence.",
  ].join("\n");
}

function repairCompletionEvidence(completion: ModelCompletionResponse): ModelErrorEvidence {
  return {
    model: completion.model,
    provider: completion.provider,
    finishReason: completion.finishReason,
    responseLength: completion.responseLength,
    rawSnippet: completion.rawSnippet,
    usage: completion.usage,
  };
}

/**
 * Reject repair replies that cannot be trusted as OpenSCAD.
 *
 * A reply that ran out of output budget mid-file used to be persisted as if it were
 * valid source: the cut-off SCAD then failed to compile and the job was parked in
 * HUMAN_REVIEW with a syntax-error artifact instead of a clear, retryable error.
 */
export function assertRepairCompletionUsable(completion: ModelCompletionResponse): void {
  const evidence = repairCompletionEvidence(completion);

  if (!completion.content.trim()) {
    const truncated = completion.finishReason === "length";
    throw new ModelRequestError(
      truncated ? "LLM_OUTPUT_TRUNCATED" : "LLM_EMPTY_RESPONSE",
      truncated
        ? `The repair model exhausted its output budget before writing any SCAD (length: ${completion.responseLength} chars). Retry, or choose a model that does not spend the budget on hidden reasoning.`
        : `The repair model returned no content (length: ${completion.responseLength} chars).`,
      true,
      { evidence },
    );
  }

  if (completion.finishReason === "length") {
    throw new ModelRequestError(
      "LLM_OUTPUT_TRUNCATED",
      `The repair model response was cut off before it finished (length: ${completion.responseLength} chars). The truncated SCAD was discarded instead of being rendered.`,
      true,
      { evidence },
    );
  }
}

/**
 * Run a single LLM-driven repair attempt.
 *
 * Loads the scad-repair skill, builds a repair context from validation failures,
 * calls the LLM once, and returns the repaired result.
 */
export async function runRepair(input: RepairInput): Promise<{
  generationResult: StructuredGenerationResult;
  repairMeta: RepairResult;
}> {
  const [skillContent, libraryPrompt] = await Promise.all([
    loadSkill("scad-repair"),
    buildScadLibraryPrompt(),
  ]);
  const systemPrompt = skillContent
    ? [skillInstructions(skillContent), libraryPrompt].filter(Boolean).join("\n\n")
    : "You are a CAD repair engineer. Fix the SCAD code to pass all validation checks.";

  const userPrompt = buildRepairPrompt(input);

  const modelStartedAt = Date.now();
  const completion = await createChatCompletionDetailed({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model: input.requestedModel?.trim() || undefined,
    stream: false,
    signal: input.signal,
  });

  const rawContent = completion.content;
  assertRepairCompletionUsable(completion);
  const evidence = repairCompletionEvidence(completion);

  let generationResult: StructuredGenerationResult;
  try {
    generationResult = normalizeGenerationResult(
      rawContent,
      [],
      `Repaired ${input.partFamily} part`
    );
  } catch (parseError) {
    throw new ModelRequestError(
      "LLM_FORMAT_INVALID",
      `The repair model returned neither valid structured JSON nor recognizable OpenSCAD (length: ${completion.responseLength} chars).`,
      true,
      { evidence, cause: parseError instanceof Error ? parseError : undefined },
    );
  }

  const sanitizedScadSource = sanitizeGeneratedScadSource(generationResult.scad_source);
  // A repair can rewrite the whole artifact. Re-extract the editable controls from
  // the repaired source so callers persist the real parameters instead of the
  // stale generation-era schema.
  const repairedParameters = mergeExtractedParameters(
    extractParameterDefsFromScad(sanitizedScadSource),
    generationResult.parameters,
  );

  // Extract repair summary from the raw response
  let repairMeta: RepairResult = {
    scad_source: sanitizedScadSource,
    repair_summary: generationResult.design_rationale?.[0] || "Repair applied based on validation feedback",
    risk: "medium",
    requires_rerender: true,
    assumptions: [],
    instruction_fingerprint: createHash("sha256").update(systemPrompt).digest("hex"),
    model_execution: {
      model: completion.model,
      provider: completion.provider,
      usage: completion.usage,
      latency_ms: Date.now() - modelStartedAt,
    },
  };

  // Try to extract explicit repair metadata from response
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*"repair_summary"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.repair_summary) repairMeta.repair_summary = parsed.repair_summary;
      if (parsed.risk) repairMeta.risk = parsed.risk;
      if (parsed.assumptions) repairMeta.assumptions = parsed.assumptions;
    }
  } catch {
    // Non-critical: use defaults
  }

  return {
    generationResult: {
      ...emptyStructuredDefaults(),
      ...generationResult,
      scad_source: sanitizedScadSource,
      parameters: repairedParameters,
      part_type: input.cadIntent?.part_type || input.partFamily,
      features: (input.cadIntent?.features as StructuredGenerationResult["features"]) || [],
      modeling_plan: (input.cadIntent?.modeling_plan as string[]) || [],
      validation_targets: input.cadIntent?.validation_targets || emptyStructuredDefaults().validation_targets,
    },
    repairMeta,
  };
}
