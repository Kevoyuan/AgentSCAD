import type { LLMGenerationResult, ParameterDef, StructuredGenerationResult } from "@/lib/harness/types";

export function stripMarkdownFence(rawContent: string): string {
  return rawContent
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
}

export function extractJsonObjectText(rawContent: string): string {
  const cleaned = stripMarkdownFence(rawContent);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return cleaned;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

export function extractOpenScadCodeFromText(rawContent: string): string | null {
  const fenced = rawContent.match(/```(?:openscad|scad)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced?.[1] && scoreOpenScadCode(fenced[1]) >= 3) {
    return fenced[1].trim();
  }

  const cleaned = stripMarkdownFence(rawContent);
  return scoreOpenScadCode(cleaned) >= 5 ? cleaned.trim() : null;
}

export function parseJsonObject<T>(rawContent: string): T;
export function parseJsonObject<T>(rawContent: string, fallback: T): T;
export function parseJsonObject<T>(rawContent: string, fallback?: T): T {
  try {
    return JSON.parse(extractJsonObjectText(rawContent)) as T;
  } catch (error) {
    if (arguments.length >= 2) {
      return fallback as T;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Two-part format parser (v2.0)
//
// Expected format:
//   { "part_type": "...", "features": [...], ... }
//   ```scad
//   include <agentscad_std.scad>;
//   ...
//   ```
//
// The parser extracts:
//   1. SCAD code from the last markdown code fence in the response
//   2. JSON metadata from the text before the code fence
//   3. Falls back to old single-JSON format when no code fence is present
// ---------------------------------------------------------------------------

interface ParsedTwoPart {
  jsonText: string;
  scadCode: string | null;
}

function parseTwoPart(rawContent: string): ParsedTwoPart {
  // Find the last SCAD/OpenSCAD code fence
  const fencePattern = /```(?:scad|openscad)?\s*\n([\s\S]*?)\n```/gi;
  const fences: { index: number; code: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(rawContent)) !== null) {
    fences.push({ index: match.index, code: match[1].trim() });
  }

  if (fences.length > 0) {
    const lastFence = fences[fences.length - 1];
    const jsonText = rawContent.slice(0, lastFence.index).trim();
    return { jsonText, scadCode: lastFence.code };
  }

  // No code fence — the entire content might be the old JSON format
  // or raw SCAD code
  return { jsonText: rawContent, scadCode: null };
}

function parseStructuredJson(jsonText: string): Partial<StructuredGenerationResult> | null {
  try {
    const extracted = extractJsonObjectText(jsonText);
    const parsed = JSON.parse(extracted) as Record<string, unknown>;

    // Validate it has at least some v2.0 fields
    if (typeof parsed.part_type === "string" || Array.isArray(parsed.features)) {
      return parsed as Partial<StructuredGenerationResult>;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize an LLM response into a structured generation result.
 *
 * v2.0 two-part format:
 *   Parses JSON metadata + SCAD code fence.
 *   Falls back to old format if the v2.0 JSON is not recognized.
 *
 * Old format (v1.x):
 *   Single JSON object with summary, parameters, scad_source.
 *   Falls back to raw SCAD extraction if JSON parsing fails.
 */
export function normalizeGenerationResult(
  rawContent: string,
  fallbackParameters: ParameterDef[],
  fallbackSummary: string
): StructuredGenerationResult {
  const { jsonText, scadCode } = parseTwoPart(rawContent);

  // Try v2.0 structured format first
  const structured = parseStructuredJson(jsonText);
  if (structured && scadCode) {
    return {
      part_type: structured.part_type ?? "unknown",
      summary: structured.summary ?? fallbackSummary,
      units: structured.units ?? "mm",
      features: Array.isArray(structured.features) ? structured.features : [],
      constraints: structured.constraints ?? {
        dimensions: {},
        assumptions: [],
        manufacturing: { min_wall_thickness: 2, printable: true },
        geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
        code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
      },
      modeling_plan: Array.isArray(structured.modeling_plan) ? structured.modeling_plan : [],
      design_rationale: Array.isArray(structured.design_rationale) ? structured.design_rationale : [],
      validation_targets: structured.validation_targets ?? {
        expected_bbox: [],
        required_feature_checks: [],
        forbidden_failure_modes: [],
      },
      parameters: Array.isArray(structured.parameters)
        ? structured.parameters
        : fallbackParameters,
      scad_source: scadCode,
    };
  }

  // Try v2.0 structured JSON with scad_source embedded (no separate fence)
  if (structured && typeof structured.scad_source === "string" && structured.scad_source.length > 20) {
    return {
      part_type: structured.part_type ?? "unknown",
      summary: structured.summary ?? fallbackSummary,
      units: structured.units ?? "mm",
      features: Array.isArray(structured.features) ? structured.features : [],
      constraints: structured.constraints ?? {
        dimensions: {},
        assumptions: [],
        manufacturing: { min_wall_thickness: 2, printable: true },
        geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
        code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
      },
      modeling_plan: Array.isArray(structured.modeling_plan) ? structured.modeling_plan : [],
      design_rationale: Array.isArray(structured.design_rationale) ? structured.design_rationale : [],
      validation_targets: structured.validation_targets ?? {
        expected_bbox: [],
        required_feature_checks: [],
        forbidden_failure_modes: [],
      },
      parameters: Array.isArray(structured.parameters)
        ? structured.parameters
        : fallbackParameters,
      scad_source: structured.scad_source,
    };
  }

  // Fall back to v1.x format: try parsing as old LLMGenerationResult
  let parsed: Partial<LLMGenerationResult>;
  try {
    parsed = parseJsonObject<Partial<LLMGenerationResult>>(jsonText);
  } catch {
    // Try extracting SCAD from the full raw content
    const extractedScad = extractOpenScadCodeFromText(rawContent);
    if (!extractedScad) {
      throw new Error("LLM response was neither valid structured JSON nor recognizable OpenSCAD");
    }
    parsed = {
      summary: fallbackSummary,
      parameters: fallbackParameters,
      scad_source: extractedScad,
    };
  }

  if (!parsed.scad_source || typeof parsed.scad_source !== "string") {
    throw new Error("LLM response missing scad_source");
  }

  return {
    part_type: "unknown",
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary
        : fallbackSummary,
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
    parameters: Array.isArray(parsed.parameters)
      ? parsed.parameters
      : fallbackParameters,
    scad_source: parsed.scad_source,
  };
}

function scoreOpenScadCode(code: string): number {
  if (!code || code.length < 20) return 0;

  const patterns = [
    /\b(cube|sphere|cylinder|polyhedron)\s*\(/gi,
    /\b(union|difference|intersection)\s*\(/gi,
    /\b(translate|rotate|scale|mirror)\s*\(/gi,
    /\b(linear_extrude|rotate_extrude)\s*\(/gi,
    /\b(module|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gi,
    /\$fn\s*=/gi,
    /\bfor\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*\[/gi,
    /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*[^;]+;/gm,
  ];

  return patterns.reduce((score, pattern) => {
    const matches = code.match(pattern);
    return score + (matches?.length ?? 0);
  }, 0);
}
