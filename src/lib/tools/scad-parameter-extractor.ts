import type { ParameterDef } from "@/lib/harness/types";

const ASSIGNMENT_RE =
  /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);[\t ]*(?:\/\/\s*(.*))?$/;
const GROUP_BLOCK_RE = /^\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;
const GROUP_COMMENT_RE = /^\/\/\s*-{2,}\s*([^-]+?)\s*-{2,}\s*$/;
const GEOMETRY_START_RE =
  /^\s*(module|function|union|difference|intersection|translate|rotate|scale|mirror|color|cube|sphere|cylinder|polyhedron|linear_extrude|rotate_extrude|minkowski|hull)\b/;

const RESERVED_PARAMETER_NAMES = new Set([
  "module",
  "function",
  "if",
  "else",
  "for",
  "let",
  "use",
  "include",
]);

interface ParsedRange {
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

export function extractParameterDefsFromScad(scadSource: string): ParameterDef[] {
  const parameters = new Map<string, ParameterDef>();
  let group = "Parameters";

  for (const rawLine of scadSource.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const blockGroup = line.match(GROUP_BLOCK_RE);
    if (blockGroup) {
      group = toLabel(blockGroup[1]);
      continue;
    }

    const commentGroup = line.match(GROUP_COMMENT_RE);
    if (commentGroup) {
      group = toLabel(commentGroup[1]);
      continue;
    }

    const match = line.match(ASSIGNMENT_RE);
    if (!match) {
      if (GEOMETRY_START_RE.test(line)) {
        break;
      }
      continue;
    }

    const key = match[1];
    if (RESERVED_PARAMETER_NAMES.has(key)) continue;

    const numericValue = parseNumericLiteral(match[2]);
    if (numericValue === null) continue;

    const range = parseRangeComment(match[3] ?? "", numericValue);
    const kind = Number.isInteger(numericValue) ? "integer" : "float";

    parameters.set(key, {
      key,
      label: toLabel(key),
      kind,
      unit: inferUnit(key, range.description),
      value: numericValue,
      min: range.min ?? defaultMinFor(key, numericValue),
      max: range.max ?? defaultMaxFor(key, numericValue),
      step: range.step ?? defaultStepFor(kind, numericValue),
      source: "artifact",
      editable: true,
      description: range.description || `Parameter parsed from top-level OpenSCAD assignment ${key}`,
      group,
    });
  }

  return Array.from(parameters.values());
}

export function mergeExtractedParameters(
  extracted: ParameterDef[],
  fallback: ParameterDef[]
): ParameterDef[] {
  if (extracted.length === 0) return fallback;

  const fallbackByKey = new Map(fallback.map((parameter) => [parameter.key, parameter]));
  return extracted.map((parameter) => {
    const prior = fallbackByKey.get(parameter.key);
    if (!prior) return parameter;

    return {
      ...parameter,
      unit: parameter.unit || prior.unit,
      min: Number.isFinite(parameter.min) ? parameter.min : prior.min,
      max: Number.isFinite(parameter.max) ? parameter.max : prior.max,
      step: Number.isFinite(parameter.step) ? parameter.step : prior.step,
      source: prior.source === "user" ? "user" : parameter.source,
      description:
        parameter.description &&
        !parameter.description.startsWith("Parameter parsed from")
          ? parameter.description
          : prior.description,
      group: parameter.group || prior.group,
    };
  });
}

function parseNumericLiteral(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseRangeComment(comment: string, value: number): ParsedRange {
  const trimmed = comment.trim();
  if (!trimmed) return { description: "" };

  const bracketRange = trimmed.match(/^\[?\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(-?\d+(?:\.\d+)?))?\s*\]?$/);
  if (bracketRange) {
    const first = Number(bracketRange[1]);
    const second = Number(bracketRange[2]);
    const third = bracketRange[3] === undefined ? undefined : Number(bracketRange[3]);

    if (third === undefined) {
      return {
        description: "",
        min: Math.min(first, second),
        max: Math.max(first, second),
      };
    }

    return {
      description: "",
      min: first,
      step: second,
      max: third,
    };
  }

  const parsed: ParsedRange = { description: trimmed };
  const minMatch = trimmed.match(/\bmin\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const maxMatch = trimmed.match(/\bmax\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const stepMatch = trimmed.match(/\bstep\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (minMatch?.[1]) parsed.min = Number(minMatch[1]);
  if (maxMatch?.[1]) parsed.max = Number(maxMatch[1]);
  if (stepMatch?.[1]) parsed.step = Number(stepMatch[1]);

  if (parsed.min !== undefined || parsed.max !== undefined || parsed.step !== undefined) {
    return parsed;
  }

  return {
    description: trimmed,
    min: defaultMinFor("", value),
    max: defaultMaxFor("", value),
  };
}

function defaultMinFor(key: string, value: number): number {
  if (key.includes("count") || key.includes("teeth")) return 1;
  if (key.includes("angle")) return -180;
  if (value < 0) return Math.floor(value * 2);
  return 0;
}

function defaultMaxFor(key: string, value: number): number {
  if (key.includes("count")) return Math.max(12, Math.ceil(value * 2));
  if (key.includes("angle")) return 180;
  if (value === 0) return 100;
  return Math.max(value * 2, value + 10);
}

function defaultStepFor(kind: string, value: number): number {
  if (kind === "integer") return 1;
  if (Math.abs(value) < 5) return 0.1;
  return 0.5;
}

function inferUnit(key: string, description: string): string {
  const lower = `${key} ${description}`.toLowerCase();
  if (lower.includes("angle") || lower.includes("degree") || lower.includes("deg")) return "°";
  if (
    key.startsWith("$") ||
    lower.includes("$fn") ||
    lower.includes("fn") ||
    lower.includes("count") ||
    lower.includes("teeth") ||
    lower.includes("segments") ||
    lower.includes("facets") ||
    lower.includes("fragments") ||
    lower.includes("qty") ||
    lower.includes("num") ||
    lower.includes("steps") ||
    lower.includes("index") ||
    lower.includes("ratio") ||
    lower.includes("scale") ||
    lower.includes("multiplier")
  ) {
    return "";
  }
  return "mm";
}

function toLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
