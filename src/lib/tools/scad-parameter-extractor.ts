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
  const maskedLines = scadSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"/g,
    match => match.replace(/[^\r\n]/g, " ")).split(/\r?\n/);

  for (const [index, rawLine] of scadSource.split(/\r?\n/).entries()) {
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
    if (!maskedLines[index].trim()) continue;

    const match = line.match(ASSIGNMENT_RE);
    if (!match) {
      if (GEOMETRY_START_RE.test(maskedLines[index])) {
        break;
      }
      continue;
    }

    const key = match[1];
    if (RESERVED_PARAMETER_NAMES.has(key)) continue;

    const literal = match[2].trim();
    if (literal === "true" || literal === "false") {
      parameters.set(key, {
        key, label: toLabel(key), kind: "boolean", unit: "", value: literal === "true",
        min: 0, max: 1, step: 1, source: "artifact", editable: true,
        description: match[3]?.trim() || `Boolean parsed from top-level OpenSCAD assignment ${key}`,
        group,
      });
      continue;
    }
    const numericValue = parseNumericLiteral(literal);
    if (numericValue === null) continue;

    const range = parseRangeComment(match[3] ?? "");
    // SCAD numeric literals do not declare an integer-only domain.
    const kind = "float";
    const { description, ...numericConstraints } = range;

    parameters.set(key, {
      key,
      label: toLabel(key),
      kind,
      unit: inferUnit(key, description),
      value: numericValue,
      min: range.min ?? defaultMinFor(key, numericValue),
      max: range.max ?? defaultMaxFor(key, numericValue),
      step: range.step ?? defaultStepFor(kind, numericValue),
      numericConstraints,
      source: "artifact",
      editable: true,
      description: description || `Parameter parsed from top-level OpenSCAD assignment ${key}`,
      group,
    });
  }

  return Array.from(parameters.values());
}

/** Backfill boolean controls and upgrade identifiable legacy extractor defaults.
 * User-authored or customized numeric limits retain their original semantics. */
export function withSourceParameterMetadata<T extends {
  key?: unknown; kind?: unknown; value?: unknown; source?: unknown; description?: unknown;
  min?: unknown; max?: unknown; step?: unknown; numericConstraints?: unknown;
}>(
  parameters: T[], scadSource: string,
): Array<T | ParameterDef> {
  const extracted = extractParameterDefsFromScad(scadSource);
  const byKey = new Map(extracted.map(parameter => [parameter.key, parameter]));
  const upgraded = parameters.map(prior => {
    const current = byKey.get(String(prior.key));
    if (!current?.numericConstraints || prior.numericConstraints !== undefined || prior.source !== "artifact"
      || typeof prior.value !== "number" || !Number.isFinite(prior.value) || prior.description !== current.description) return prior;
    const legacyKind = Number.isInteger(prior.value) ? "integer" : "float";
    const plainComment = Object.keys(current.numericConstraints).length === 0
      && current.description !== `Parameter parsed from top-level OpenSCAD assignment ${current.key}`;
    const hintKey = plainComment ? "" : current.key;
    const legacyMin = current.numericConstraints.min ?? defaultMinFor(hintKey, prior.value);
    const legacyMax = current.numericConstraints.max ?? defaultMaxFor(hintKey, prior.value);
    const legacyStep = current.numericConstraints.step ?? defaultStepFor(legacyKind, prior.value);
    if (prior.kind !== legacyKind || prior.min !== legacyMin || prior.max !== legacyMax || prior.step !== legacyStep) return prior;
    return { ...prior, kind: current.kind, min: current.min, max: current.max, step: current.step,
      numericConstraints: current.numericConstraints };
  });
  const missing = extracted.filter(parameter => parameter.kind === "boolean"
    && !parameters.some(prior => prior.key === parameter.key && prior.kind === "boolean" && typeof prior.value === "boolean"));
  const replacedKeys = new Set(missing.map(parameter => parameter.key));
  return [...upgraded.filter(parameter => !replacedKeys.has(String(parameter.key))), ...missing];
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
    const keepUserLimits = prior.source === "user" && parameter.numericConstraints
      && Object.keys(parameter.numericConstraints).length === 0;

    return {
      ...parameter,
      kind: keepUserLimits ? prior.kind : parameter.kind,
      unit: parameter.kind === "boolean" ? "" : parameter.unit || prior.unit,
      min: keepUserLimits ? prior.min : parameter.min,
      max: keepUserLimits ? prior.max : parameter.max,
      step: keepUserLimits ? prior.step : parameter.step,
      numericConstraints: keepUserLimits ? prior.numericConstraints : parameter.numericConstraints,
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

function parseRangeComment(comment: string): ParsedRange {
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

  return parsed;
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
