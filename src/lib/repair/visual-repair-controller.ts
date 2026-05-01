// ---------------------------------------------------------------------------
// Visual Repair Controller — user-triggered VLM-based repair
//
// Runs only when the user explicitly clicks "Visual Repair" after seeing
// the preview. Sends the rendered image + original request + current SCAD
// to a vision-capable LLM, parses the visual issues, then repairs the SCAD.
// ---------------------------------------------------------------------------

import { loadSkill } from "@/lib/skill-resolver";
import { createChatCompletionWithFallback } from "@/lib/tools/model-router";
import { createMimoChatCompletion } from "@/lib/mimo";
import { normalizeGenerationResult } from "@/lib/harness/structured-output";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";

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
  scadSource: string;
  previewImagePath: string;
  requestedModel?: string | null;
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
    "## Current SCAD Source",
    "```scad",
    input.scadSource,
    "```",
    "",
    "## Task",
    "Examine the rendered preview image above.",
    "Compare it against the original request and SCAD source.",
    "Identify any visual discrepancies between what was requested and what was generated.",
    "",
    "Return a JSON object:",
    '{',
    '  "visual_issues": [',
    '    {',
    '      "requirement": "what the user asked for",',
    '      "observed": "what is actually visible in the preview",',
    '      "severity": "high|medium|low",',
    '      "repair_hint": "specific fix instruction for the SCAD code"',
    '    }',
    '  ],',
    '  "overall_visual_match": 0.85',
    '}',
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
  });

  // Parse visual report from response
  let visualReport: VisualRepairReport = {
    visual_issues: [],
    overall_visual_match: 0.5,
    repair_summary: "Visual analysis completed",
  };

  try {
    const jsonStr = rawContent.match(/\{[\s\S]*"visual_issues"[\s\S]*\}/)?.[0];
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.visual_issues)) {
        visualReport.visual_issues = parsed.visual_issues;
      }
      if (typeof parsed.overall_visual_match === "number") {
        visualReport.overall_visual_match = parsed.overall_visual_match;
      }
    }
  } catch {
    // Use defaults if parsing fails
  }

  visualReport.repair_summary =
    visualReport.visual_issues.length > 0
      ? `Found ${visualReport.visual_issues.length} visual issue(s): ` +
        visualReport.visual_issues.map((i) => i.requirement).join("; ")
      : "No visual discrepancies detected";

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
}): Promise<{
  repairedScad: string;
  visualReport: VisualRepairReport;
  repairSummary: string;
}> {
  // Step 1: VLM analysis
  const { visualReport } = await runVisualAnalysis(input);

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
