// ---------------------------------------------------------------------------
// Repair Controller — orchestrates validation-driven LLM repair
//
// Used by the pipeline and the repair API route. Takes the failed job context,
// builds a repair prompt from the scad-repair skill, calls the LLM once,
// and returns the repaired result.
// ---------------------------------------------------------------------------

import { loadSkill } from "@/lib/skill-resolver";
import {
  createChatCompletionDetailed,
  type ModelCompletionResponse,
} from "@/lib/tools/model-router";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";
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
}

export interface RepairResult {
  scad_source: string;
  repair_summary: string;
  risk: "low" | "medium" | "high";
  requires_rerender: boolean;
  assumptions: string[];
}

function emptyStructuredDefaults() {
  return {
    part_type: "unknown",
    units: "mm",
    features: [],
    constraints: {
      dimensions: {},
      assumptions: [],
      manufacturing: { min_wall_thickness: 2, printable: true },
      geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
      code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
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

function buildRepairPrompt(input: RepairInput): string {
  const failedRules = input.validationResults
    .filter((r) => !r.passed)
    .map((r) => `- ${r.rule_id} ${r.rule_name} (${r.is_critical ? "CRITICAL" : "non-critical"}): ${r.message}`)
    .join("\n");

  const passedRules = input.validationResults
    .filter((r) => ["PASS", "WARN"].includes(getValidationEvidenceStatus(r)))
    .map((r) => `- ${r.rule_id} ${r.rule_name}: ${r.message}`)
    .join("\n");

  const intentBlock = input.cadIntent
    ? [
        `Part type: ${input.cadIntent.part_type || "unknown"}`,
        `Features: ${JSON.stringify(input.cadIntent.features || [])}`,
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
    "### Passed Rules",
    passedRules || "(none)",
    "",
    "## Repair Goal",
    "Fix ONLY the failed validation checks listed above.",
    "Do NOT change dimensions or features that already pass validation.",
    "Preserve all required features from the CAD intent.",
    "Use AgentSCAD standard library modules (include <agentscad_std.scad>) when possible.",
    "Keep parameters as top-level assignments.",
    "",
    "Return the full corrected structured JSON with updated scad_code:",
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
  const skillContent = await loadSkill("scad-repair");
  const systemPrompt = skillContent
    ? skillContent
        .replace(/^---[\s\S]*?---\s*/, "")
        .trim()
    : "You are a CAD repair engineer. Fix the SCAD code to pass all validation checks.";

  const userPrompt = buildRepairPrompt(input);

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

  // Extract repair summary from the raw response
  let repairMeta: RepairResult = {
    scad_source: sanitizedScadSource,
    repair_summary: generationResult.design_rationale?.[0] || "Repair applied based on validation feedback",
    risk: "medium",
    requires_rerender: true,
    assumptions: [],
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
      part_type: input.cadIntent?.part_type || input.partFamily,
      features: (input.cadIntent?.features as StructuredGenerationResult["features"]) || [],
      modeling_plan: (input.cadIntent?.modeling_plan as string[]) || [],
      validation_targets: input.cadIntent?.validation_targets || emptyStructuredDefaults().validation_targets,
    },
    repairMeta,
  };
}
