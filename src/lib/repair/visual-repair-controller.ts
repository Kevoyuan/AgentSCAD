// ---------------------------------------------------------------------------
// Visual Repair Controller — user-triggered VLM-based repair
//
// Runs only when the user explicitly clicks "Visual Repair" after seeing
// the preview. The visual evaluator receives only rendered pixels plus the
// original request; current SCAD is supplied later to the repair model.
// ---------------------------------------------------------------------------

import { loadSkill } from "@/lib/skill-resolver";
import { createChatCompletionWithFallback } from "@/lib/tools/model-router";
import { createMimoChatCompletion } from "@/lib/mimo";
import { normalizeGenerationResult } from "@/lib/harness/structured-output";
import { parseJsonObject } from "@/lib/harness/structured-output";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";
import type { ValidationResult } from "@/lib/mesh-validator";

export interface VisualIssue {
  requirement: string;
  observed: string;
  severity: "high" | "medium" | "low";
  repair_hint: string;
}

export interface VisualRepairReport {
  visual_issues: VisualIssue[];
  overall_visual_match: number; // 0–1
  repair_summary: string;
}

function boundedText(value: unknown, maxChars = 500): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars)
    : "";
}

function normalizeSeverity(value: unknown): VisualIssue["severity"] {
  const severity = boundedText(value, 32).toLowerCase();
  if (severity === "critical" || severity === "high") return "high";
  if (severity === "warning" || severity === "medium") return "medium";
  return "low";
}

export function normalizeVisualRepairReport(rawContent: string): VisualRepairReport {
  const parsed = parseJsonObject<Record<string, unknown>>(rawContent);
  const rawIssues = Array.isArray(parsed.visual_issues)
    ? parsed.visual_issues
    : Array.isArray(parsed.issues)
      ? parsed.issues
      : null;
  if (!rawIssues) throw new Error("Vision response is missing an issues array");

  const visualIssues = rawIssues.slice(0, 12).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const issue = value as Record<string, unknown>;
    const requirement = boundedText(issue.requirement ?? issue.feature, 240);
    const observed = boundedText(issue.observed ?? issue.message, 400);
    if (!requirement && !observed) return [];
    return [{
      requirement: requirement || "visible design intent",
      observed: observed || "visible discrepancy reported",
      severity: normalizeSeverity(issue.severity),
      repair_hint: boundedText(issue.repair_hint, 400)
        || `Inspect and correct the ${requirement || "reported visual discrepancy"}.`,
    }];
  });

  const missingFeatures = Array.isArray(parsed.missing_features)
    ? parsed.missing_features.map((value) => boundedText(value, 200)).filter(Boolean).slice(0, 8)
    : [];
  for (const feature of missingFeatures) {
    visualIssues.push({
      requirement: feature,
      observed: "The required feature is not visible in the supplied render.",
      severity: "high",
      repair_hint: `Add or expose the required ${feature} in the generated geometry.`,
    });
  }

  const rawMatch = typeof parsed.overall_visual_match === "number"
    ? parsed.overall_visual_match
    : typeof parsed.confidence === "number"
      ? parsed.confidence
      : parsed.passed === false
        ? 0
        : parsed.passed === true
          ? 0.8
          : Number.NaN;
  if (!Number.isFinite(rawMatch)) throw new Error("Vision response is missing a confidence score");
  const overallVisualMatch = Math.max(0, Math.min(1, rawMatch));
  if (parsed.passed === false && visualIssues.length === 0) {
    throw new Error("Vision response failed the render without an actionable visual issue");
  }

  return {
    visual_issues: visualIssues,
    overall_visual_match: overallVisualMatch,
    repair_summary: visualIssues.length > 0
      ? `Found ${visualIssues.length} visual issue(s): ${visualIssues.map((issue) => issue.requirement).join("; ")}`
      : boundedText(parsed.summary, 400) || "No visual discrepancies detected",
  };
}

export function visualRepairReportToValidationResult(report: VisualRepairReport): ValidationResult {
  const hasHighIssue = report.visual_issues.some((issue) => issue.severity === "high");
  const hasWarning = report.visual_issues.length > 0 || report.overall_visual_match < 0.75;
  const status = hasHighIssue ? "FAIL" : hasWarning ? "WARN" : "PASS";
  return {
    rule_id: "V001",
    rule_name: "Visual Design Intent Match",
    level: "SEMANTIC",
    passed: status !== "FAIL",
    status,
    is_critical: status === "FAIL",
    message: `${report.repair_summary} Visual match: ${Math.round(report.overall_visual_match * 100)}%.`,
  };
}

export function resolvePostRepairOutcome(
  criticalFailureRuleIds: string[],
  visualStatus: ValidationResult["status"],
): { nextState: "DELIVERED" | "HUMAN_REVIEW"; repaired: boolean; reviewReasons: string[] } {
  const visualEvaluationErrored = visualStatus === "ERROR";
  const reviewReasons = [
    ...criticalFailureRuleIds,
    ...(visualEvaluationErrored ? ["V001_ERROR"] : []),
  ];
  const repaired = criticalFailureRuleIds.length === 0 && !visualEvaluationErrored;
  return {
    nextState: repaired ? "DELIVERED" : "HUMAN_REVIEW",
    repaired,
    reviewReasons,
  };
}

async function readImageAsBase64(imagePath: string): Promise<string | null> {
  try {
    const fs = await import("fs/promises");
    const data = await fs.readFile(imagePath);
    const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Run a VLM-based visual analysis of the rendered preview against the
 * original user request. Returns structured visual issues.
 */
export async function runVisualAnalysis(input: {
  originalRequest: string;
  partFamily: string | null;
  previewImagePath: string;
  requestedModel?: string | null;
  signal?: AbortSignal;
}): Promise<{ visualReport: VisualRepairReport; rawAnalysis: string }> {
  const imageBase64 = await readImageAsBase64(input.previewImagePath);
  if (!imageBase64) {
    throw new Error(`Cannot read preview image: ${input.previewImagePath}`);
  }

  const skillContent = await loadSkill("scad-visual-validate");
  const systemPrompt = skillContent
    ? skillContent.replace(/^---[\s\S]*?---\s*/, "").trim()
    : "You are a CAD visual inspector. Compare the rendered preview image against the user's request and identify visual discrepancies.";

  const userPrompt = [
    "## Original Request",
    input.originalRequest,
    "",
    "## Part Family",
    input.partFamily || "unknown",
    "",
    "## Task",
    "Examine the rendered preview image.",
    "Compare only visible pixels against the original request.",
    "Do not infer a feature from source code or generation rationale; neither is provided.",
    "Identify any visual discrepancies between what was requested and what was generated.",
    "Return strict JSON according to the visual-validation skill contract.",
  ].join("\n");

  const rawContent = await createChatCompletionWithFallback({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: imageBase64 } },
        ],
      } as unknown as { role: string; content: string },
    ],
    model: input.requestedModel?.trim() || undefined,
    stream: false,
    signal: input.signal,
  });

  const visualReport = normalizeVisualRepairReport(rawContent);

  return { visualReport, rawAnalysis: rawContent };
}

/**
 * Run a full visual repair: VLM analysis → LLM repair → updated SCAD.
 */
export async function runVisualRepair(input: {
  originalRequest: string;
  partFamily: string | null;
  scadSource: string;
  previewImagePath: string;
  requestedModel?: string | null;
  signal?: AbortSignal;
}): Promise<{
  repairedScad: string;
  visualReport: VisualRepairReport;
  repairSummary: string;
}> {
  // Step 1: VLM analysis
  const { visualReport } = await runVisualAnalysis({
    originalRequest: input.originalRequest,
    partFamily: input.partFamily,
    previewImagePath: input.previewImagePath,
    requestedModel: input.requestedModel,
    signal: input.signal,
  });

  if (visualReport.visual_issues.length === 0) {
    return {
      repairedScad: input.scadSource,
      visualReport,
      repairSummary: "No visual issues detected — SCAD unchanged",
    };
  }

  // Step 2: LLM repair using visual feedback
  const repairPrompt = [
    "## Original Request",
    input.originalRequest,
    "",
    "## Current SCAD Code",
    "```scad",
    input.scadSource,
    "```",
    "",
    "## Visual Issues Found",
    ...visualReport.visual_issues.map(
      (issue, i) =>
        `${i + 1}. **${issue.requirement}** (${issue.severity})` +
        `\n   Observed: ${issue.observed}` +
        `\n   Repair hint: ${issue.repair_hint}`
    ),
    "",
    "## Task",
    "Fix the SCAD code to address ALL visual issues listed above.",
    "Preserve features and dimensions that are visually correct.",
    "Use AgentSCAD standard library modules when possible.",
    "Return structured JSON with updated scad_source, then the SCAD code in a fence.",
  ].join("\n");

  const rawContent = await createChatCompletionWithFallback({
    messages: [
      {
        role: "system",
        content:
          "You are a CAD repair engineer. Fix OpenSCAD code to address specific visual issues identified by a vision model. " +
          "Make minimal, targeted fixes. Do not change dimensions or features that are visually correct.",
      },
      { role: "user", content: repairPrompt },
    ],
    model: input.requestedModel?.trim() || undefined,
    stream: false,
    signal: input.signal,
  });

  const generationResult = normalizeGenerationResult(
    rawContent,
    [],
    `Visually repaired ${input.partFamily || "part"}`
  );

  const repairedScad = sanitizeGeneratedScadSource(generationResult.scad_source);

  return {
    repairedScad,
    visualReport,
    repairSummary:
      generationResult.summary ||
      `Repaired ${visualReport.visual_issues.length} visual issue(s)`,
  };
}
