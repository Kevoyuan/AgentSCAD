import type { LLMGenerationResult, ParameterDef, StructuredGenerationResult } from "@/lib/harness/types";
import { createControlledSnippet } from "@/lib/model-runtime";

export class CadGenerationFormatError extends Error {
  readonly snippet: string;
  readonly responseLength: number;

  constructor(message: string, rawContent: string) {
    super(message);
    this.name = "CadGenerationFormatError";
    this.snippet = createControlledSnippet(rawContent, 600);
    this.responseLength = rawContent?.length ?? 0;
  }
}

export function stripReasoningTags(rawContent: string): string {
  if (!rawContent) return "";
  return rawContent
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .trim();
}

export function stripMarkdownFence(rawContent: string): string {
  const cleaned = stripReasoningTags(rawContent);
  return cleaned
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

interface ExtractedCodeBlock {
  index: number;
  lang: string;
  code: string;
}

export function extractAllCodeBlocks(rawContent: string): ExtractedCodeBlock[] {
  const cleaned = stripReasoningTags(rawContent);
  const codeBlockRegex = /(?:^|\n)```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g;
  const blocks: ExtractedCodeBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(cleaned)) !== null) {
    const lang = (match[1] || "").toLowerCase().trim();
    const code = match[2].trim();
    if (code.length >= 10) {
      blocks.push({
        index: match.index,
        lang,
        code,
      });
    }
  }

  return blocks;
}

export function findBestScadCodeFence(rawContent: string): string | null {
  const blocks = extractAllCodeBlocks(rawContent);
  if (blocks.length === 0) return null;

  // 1. First look for blocks explicitly tagged as scad or openscad
  const scadTagged = blocks.filter((b) => b.lang === "scad" || b.lang === "openscad");
  if (scadTagged.length > 0) {
    // Return the last tagged block or the highest scoring one
    return scadTagged[scadTagged.length - 1].code;
  }

  // 2. Otherwise find the block with the highest OpenSCAD score >= 1
  let bestCode: string | null = null;
  let maxScore = 0;
  for (const block of blocks) {
    // Skip explicit json or markdown blocks if score is low
    if (block.lang === "json" || block.lang === "yaml") continue;
    const score = scoreOpenScadCode(block.code);
    if (score > maxScore) {
      maxScore = score;
      bestCode = block.code;
    }
  }

  return maxScore >= 1 ? bestCode : null;
}

export function extractOpenScadCodeFromText(rawContent: string): string | null {
  const bestFenced = findBestScadCodeFence(rawContent);
  if (bestFenced) {
    return bestFenced;
  }

  const cleanedContent = stripReasoningTags(rawContent);
  const cleaned = stripMarkdownFence(cleanedContent);
  return scoreOpenScadCode(cleaned) >= 3 ? cleaned.trim() : null;
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
//   1. SCAD code from the markdown code fence in the response
//   2. JSON metadata from the text before the code fence
//   3. Falls back to single-JSON or raw SCAD when no code fence is present
// ---------------------------------------------------------------------------

interface ParsedTwoPart {
  jsonText: string;
  scadCode: string | null;
}

function parseTwoPart(rawContent: string): ParsedTwoPart {
  const cleaned = stripReasoningTags(rawContent);
  const blocks = extractAllCodeBlocks(cleaned);

  if (blocks.length > 0) {
    // Look for explicit scad/openscad blocks first
    const scadBlocks = blocks.filter((b) => b.lang === "scad" || b.lang === "openscad");
    const chosenBlock =
      scadBlocks.length > 0
        ? scadBlocks[scadBlocks.length - 1]
        : blocks.filter((b) => b.lang !== "json" && scoreOpenScadCode(b.code) >= 1).pop() ||
          blocks[blocks.length - 1];

    if (chosenBlock && (chosenBlock.lang === "scad" || chosenBlock.lang === "openscad" || scoreOpenScadCode(chosenBlock.code) >= 1)) {
      const jsonText = cleaned.slice(0, chosenBlock.index).trim();
      return { jsonText, scadCode: chosenBlock.code };
    }
  }

  return { jsonText: cleaned, scadCode: null };
}

function parseStructuredJson(jsonText: string): Partial<StructuredGenerationResult> | null {
  try {
    const extracted = extractJsonObjectText(jsonText);
    const parsed = JSON.parse(extracted) as Record<string, unknown>;

    if (
      typeof parsed.part_type === "string" ||
      Array.isArray(parsed.features) ||
      typeof parsed.summary === "string" ||
      Array.isArray(parsed.parameters) ||
      typeof parsed.scad_source === "string"
    ) {
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
  const cleanedRaw = stripReasoningTags(rawContent);
  const { jsonText, scadCode } = parseTwoPart(cleanedRaw);

  const structured = parseStructuredJson(jsonText);
  const effectiveScad =
    scadCode ||
    (typeof structured?.scad_source === "string" && structured.scad_source.length >= 10
      ? structured.scad_source
      : null);

  if (effectiveScad) {
    return {
      part_type: structured?.part_type ?? "unknown",
      summary:
        typeof structured?.summary === "string" && structured.summary.trim()
          ? structured.summary
          : fallbackSummary,
      units: structured?.units ?? "mm",
      features: Array.isArray(structured?.features) ? structured.features : [],
      constraints: structured?.constraints ?? {
        dimensions: {},
        assumptions: [],
        manufacturing: { min_wall_thickness: 2, printable: true },
        geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
        code: {
          use_parameters: true,
          use_library_modules: true,
          avoid_magic_numbers: true,
          top_level_module: "generated_part",
        },
      },
      modeling_plan: Array.isArray(structured?.modeling_plan) ? structured.modeling_plan : [],
      design_rationale: Array.isArray(structured?.design_rationale)
        ? structured.design_rationale
        : [],
      validation_targets: structured?.validation_targets ?? {
        expected_bbox: [],
        required_feature_checks: [],
        forbidden_failure_modes: [],
      },
      parameters: Array.isArray(structured?.parameters)
        ? structured.parameters
        : fallbackParameters,
      scad_source: effectiveScad,
    };
  }

  // Fall back to v1.x format: try parsing as old LLMGenerationResult
  let parsed: Partial<LLMGenerationResult> | null = null;
  try {
    parsed = parseJsonObject<Partial<LLMGenerationResult>>(jsonText);
  } catch {
    parsed = null;
  }

  const extractedScad =
    (typeof parsed?.scad_source === "string" && parsed.scad_source.length >= 10
      ? parsed.scad_source
      : null) || extractOpenScadCodeFromText(cleanedRaw);

  if (!extractedScad) {
    throw new CadGenerationFormatError(
      "LLM response was neither valid structured JSON nor recognizable OpenSCAD",
      cleanedRaw
    );
  }

  return {
    part_type: "unknown",
    summary:
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary
        : fallbackSummary,
    units: "mm",
    features: [],
    constraints: {
      dimensions: {},
      assumptions: [],
      manufacturing: { min_wall_thickness: 2, printable: true },
      geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
      code: {
        use_parameters: true,
        use_library_modules: true,
        avoid_magic_numbers: true,
        top_level_module: "generated_part",
      },
    },
    modeling_plan: [],
    design_rationale: [],
    validation_targets: {
      expected_bbox: [],
      required_feature_checks: [],
      forbidden_failure_modes: [],
    },
    parameters: Array.isArray(parsed?.parameters)
      ? parsed.parameters
      : fallbackParameters,
    scad_source: extractedScad,
  };
}

function scoreOpenScadCode(code: string): number {
  if (!code || code.length < 10) return 0;

  const patterns = [
    /\b(cube|sphere|cylinder|polyhedron)\s*\(/gi,
    /\b(union|difference|intersection|hull|minkowski)\s*\(/gi,
    /\b(translate|rotate|scale|mirror)\s*\(/gi,
    /\b(linear_extrude|rotate_extrude)\s*\(/gi,
    /\b(module|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gi,
    /\$fn\s*=/gi,
    /\bfor\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*\[/gi,
    /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*[^;]+;/gm,
    /\b(include|use)\s*<[^>]+>/gi,
    /\b(rounded_box|cylinder_boss|mounting_plate|screw_hole|bolt_pattern_rect|l_bracket|triangular_rib|enclosure_box|enclosure_lid|linear_array_x|circular_array)\s*\(/gi,
    /\b(color|offset|projection)\s*\(/gi,
    /\bgenerated_part\s*\(\s*\)/gi,
  ];

  return patterns.reduce((score, pattern) => {
    const matches = code.match(pattern);
    return score + (matches?.length ?? 0);
  }, 0);
}
