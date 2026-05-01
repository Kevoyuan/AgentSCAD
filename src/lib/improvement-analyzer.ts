// ---------------------------------------------------------------------------
// AgentSCAD Memory System v3.0
//
// Design principles borrowed from gstack's learning system, adapted for CAD:
// - Append-only JSONL (no read-merge-write, no data loss)
// - Structured numerical observations (not prose — LLM can reason on numbers)
// - Source trust levels (user_edit > repair_success > validation_pattern > generation_default)
// - Quality feedback loop (delivery_rate, repair_rate, user_edit_rate)
// - Pipeline-triggered writes (not cron-only)
// - Prompt injection defense on user-sourced content
// ---------------------------------------------------------------------------

import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// v3.0 Data Model
// ---------------------------------------------------------------------------

export type ObservationSource =
  | "user_edit"          // user manually changed SCAD or parameters
  | "repair_success"     // auto-repair fixed a validation failure
  | "repair_failure"     // auto-repair could NOT fix
  | "validation_pattern" // validation rule failure statistics
  | "generation_default" // LLM chose this value (lowest weight)
  | "visual_issue";      // VLM identified a visual discrepancy

export interface ParameterDriftObservation {
  observation_type: "parameter_drift";
  family: string;
  parameter: string;
  default_value: number;       // system/schema default
  user_value: number;          // what users actually set
  sample_size: number;
  std_dev: number;
  min_val: number;
  max_val: number;
  source: ObservationSource;
  confidence: number;          // 1-10
  outcome: {
    delivery_rate: number;     // 0-1: jobs with this value that delivered
    repair_rate: number;       // 0-1: repair attempts that succeeded
    user_edit_rate: number;    // 0-1: users who still modified this value
  };
  ts: string;                  // ISO 8601
}

export interface FeatureGapObservation {
  observation_type: "feature_gap";
  family: string;
  requested_feature: string;   // e.g., "ventilation slots"
  feature_present_in_gen: boolean;
  user_added_feature: boolean;
  repair_fixed_feature: boolean;
  source: ObservationSource;
  confidence: number;
  ts: string;
}

export interface ValidationFailureObservation {
  observation_type: "validation_failure";
  family: string;
  rule_id: string;
  rule_name: string;
  failure_count: number;
  total_checks: number;
  failure_rate: number;         // 0-1
  repair_success_rate: number;  // 0-1: how often repair fixes this rule
  source: ObservationSource;
  confidence: number;
  ts: string;
}

export interface ScadEditObservation {
  observation_type: "scad_edit";
  family: string;
  added_feature: string;        // sanitized, max 120 chars
  frequency: number;
  source: ObservationSource;
  confidence: number;
  ts: string;
}

export type Observation =
  | ParameterDriftObservation
  | FeatureGapObservation
  | ValidationFailureObservation
  | ScadEditObservation;

// ---------------------------------------------------------------------------
// Prompt Injection Defense
// ---------------------------------------------------------------------------

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?(previous|prior) (instructions|commands|prompts?)/i,
  /you are (now |acting as |playing the role of )/i,
  /system:\s*/i,
  /\[system\]/i,
  /forget (everything|your training|your instructions)/i,
  /override (all |previous )?(safety |security )?(rules|guidelines)/i,
  /disregard (all )?(previous|prior|above)/i,
  /you must (now |always )?(respond|reply|answer|output)/i,
];

function sanitizeForPromptInjection(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return null;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) return null;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Storage layer — append-only JSONL
// ---------------------------------------------------------------------------

const OBSERVATIONS_PATH = path.join(
  process.cwd(),
  "skills",
  "scad-generation",
  "learned-observations.jsonl"
);

// Legacy path for backward compatibility
const LEGACY_PATTERNS_PATH = path.join(
  process.cwd(),
  "skills",
  "scad-generation",
  "learned-patterns.json"
);

async function appendObservation(obs: Observation): Promise<void> {
  const dir = path.dirname(OBSERVATIONS_PATH);
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(obs) + "\n";
  await fs.appendFile(OBSERVATIONS_PATH, line, "utf8");
}

// ---------------------------------------------------------------------------
// Confidence scoring (mirrors gstack's source-based model)
// ---------------------------------------------------------------------------

const SOURCE_CONFIDENCE: Record<ObservationSource, number> = {
  user_edit: 9,
  repair_success: 8,
  repair_failure: 7,
  validation_pattern: 6,
  visual_issue: 5,
  generation_default: 3,
};

function effectiveConfidence(obs: Observation): number {
  const base = obs.confidence || SOURCE_CONFIDENCE[obs.source] || 5;

  // Time decay: -1 per 30 days for AI-sourced observations
  if (obs.source !== "user_edit") {
    const daysSince = (Date.now() - new Date(obs.ts).getTime()) / (1000 * 60 * 60 * 24);
    const decay = Math.floor(daysSince / 30);
    return Math.max(0, base - decay);
  }

  return base; // user_edit never decays
}

// ---------------------------------------------------------------------------
// v3.0 Write Path — pipeline-triggered observations
// ---------------------------------------------------------------------------

export async function recordParameterDrift(params: {
  family: string;
  parameter: string;
  default_value: number;
  user_value: number;
  source: ObservationSource;
  deliverySucceeded: boolean;
  repairSucceeded: boolean | null; // null = no repair attempted
}): Promise<void> {
  // Load existing observations for this parameter to compute stats
  const existing = await loadObservationsForParameter(params.family, params.parameter);

  const allValues = [...existing.values, params.user_value];
  const n = allValues.length;
  const mean = n > 0 ? allValues.reduce((a, b) => a + b, 0) / n : params.user_value;
  const variance = n > 1
    ? allValues.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;

  const deliveryRate = existing.deliveryCount > 0
    ? (existing.deliveryCount + (params.deliverySucceeded ? 1 : 0)) / (existing.totalJobs + 1)
    : (params.deliverySucceeded ? 1 : 0);

  const repairAttempts = existing.repairAttempts + (params.repairSucceeded !== null ? 1 : 0);
  const repairSuccesses = existing.repairSuccesses + (params.repairSucceeded === true ? 1 : 0);
  const repairRate = repairAttempts > 0 ? repairSuccesses / repairAttempts : 0;

  const obs: ParameterDriftObservation = {
    observation_type: "parameter_drift",
    family: params.family,
    parameter: params.parameter,
    default_value: params.default_value,
    user_value: params.user_value,
    sample_size: n,
    std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
    min_val: Math.min(...allValues),
    max_val: Math.max(...allValues),
    source: params.source,
    confidence: SOURCE_CONFIDENCE[params.source],
    outcome: {
      delivery_rate: Math.round(deliveryRate * 100) / 100,
      repair_rate: Math.round(repairRate * 100) / 100,
      user_edit_rate: 0, // computed from cross-reference, set to 0 for now
    },
    ts: new Date().toISOString(),
  };

  await appendObservation(obs);
}

export async function recordFeatureGap(params: {
  family: string;
  requestedFeature: string;
  presentInGeneration: boolean;
  userAdded: boolean;
  repairFixed: boolean;
}): Promise<void> {
  const obs: FeatureGapObservation = {
    observation_type: "feature_gap",
    family: params.family,
    requested_feature: params.requestedFeature,
    feature_present_in_gen: params.presentInGeneration,
    user_added_feature: params.userAdded,
    repair_fixed_feature: params.repairFixed,
    source: params.userAdded ? "user_edit" : "generation_default",
    confidence: params.userAdded ? 9 : 5,
    ts: new Date().toISOString(),
  };
  await appendObservation(obs);
}

export async function recordValidationFailure(params: {
  family: string;
  ruleId: string;
  ruleName: string;
  passed: boolean;
  repairSucceeded: boolean | null;
}): Promise<void> {
  const existing = await loadObservationsForRule(params.family, params.ruleId);

  const obs: ValidationFailureObservation = {
    observation_type: "validation_failure",
    family: params.family,
    rule_id: params.ruleId,
    rule_name: params.ruleName,
    failure_count: existing.failures + (params.passed ? 0 : 1),
    total_checks: existing.total + 1,
    failure_rate: existing.total > 0
      ? Math.round(((existing.failures + (params.passed ? 0 : 1)) / (existing.total + 1)) * 100) / 100
      : (params.passed ? 0 : 1),
    repair_success_rate: existing.repairAttempts > 0
      ? Math.round(((existing.repairSuccesses + (params.repairSucceeded === true ? 1 : 0)) / existing.repairAttempts) * 100) / 100
      : 0,
    source: "validation_pattern",
    confidence: SOURCE_CONFIDENCE.validation_pattern,
    ts: new Date().toISOString(),
  };
  await appendObservation(obs);
}

export async function recordScadEdit(params: {
  family: string;
  addedFeature: string;
  frequency: number;
}): Promise<void> {
  const sanitized = sanitizeForPromptInjection(params.addedFeature);
  if (!sanitized) return; // rejected by prompt injection defense

  const obs: ScadEditObservation = {
    observation_type: "scad_edit",
    family: params.family,
    added_feature: sanitized,
    frequency: params.frequency,
    source: "user_edit",
    confidence: 8,
    ts: new Date().toISOString(),
  };
  await appendObservation(obs);
}

// ---------------------------------------------------------------------------
// v3.0 Read Path — structured observations for prompt injection
// ---------------------------------------------------------------------------

interface Accumulator {
  values: number[];
  deliveryCount: number;
  repairAttempts: number;
  repairSuccesses: number;
  totalJobs: number;
  failures: number;
  total: number;
}

async function loadObservationsForParameter(
  family: string,
  parameter: string
): Promise<Accumulator> {
  const acc: Accumulator = {
    values: [],
    deliveryCount: 0,
    repairAttempts: 0,
    repairSuccesses: 0,
    totalJobs: 0,
    failures: 0,
    total: 0,
  };

  try {
    const raw = await fs.readFile(OBSERVATIONS_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as ParameterDriftObservation;
        if (obs.observation_type !== "parameter_drift") continue;
        if (obs.family !== family || obs.parameter !== parameter) continue;
        acc.values.push(obs.user_value);
        acc.totalJobs++;
        if (obs.outcome.delivery_rate > 0.5) acc.deliveryCount++;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file doesn't exist yet */ }

  return acc;
}

async function loadObservationsForRule(
  family: string,
  ruleId: string
): Promise<{ failures: number; total: number; repairAttempts: number; repairSuccesses: number }> {
  let failures = 0;
  let total = 0;
  let repairAttempts = 0;
  let repairSuccesses = 0;

  try {
    const raw = await fs.readFile(OBSERVATIONS_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as ValidationFailureObservation;
        if (obs.observation_type !== "validation_failure") continue;
        if (obs.family !== family || obs.rule_id !== ruleId) continue;
        failures += obs.failure_count;
        total += obs.total_checks;
        if (obs.repair_success_rate > 0) {
          repairAttempts++;
          if (obs.repair_success_rate > 0.5) repairSuccesses++;
        }
      } catch { /* skip */ }
    }
  } catch { /* file doesn't exist yet */ }

  return { failures, total, repairAttempts, repairSuccesses };
}

// ---------------------------------------------------------------------------
// Public API — prompt injection helper
// ---------------------------------------------------------------------------

/**
 * Get learned parameter defaults for a part family.
 * Returns structured numerical data for injection into the generation prompt.
 * Falls back to legacy patterns file if no v3.0 observations exist.
 */
export async function getLearnedDefaultsForFamily(
  family: string
): Promise<string> {
  const dedupMap = new Map<string, ParameterDriftObservation>();

  try {
    const raw = await fs.readFile(OBSERVATIONS_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as Observation;
        if (obs.observation_type !== "parameter_drift") continue;
        if (obs.family !== family) continue;

        const key = `${obs.parameter}:${obs.source}`;
        const existing = dedupMap.get(key);
        if (!existing || new Date(obs.ts) > new Date(existing.ts)) {
          dedupMap.set(key, obs);
        }
      } catch { /* skip */ }
    }
  } catch {
    // Fall back to legacy
    return getLearnedPatternsForFamily(family);
  }

  if (dedupMap.size === 0) return "";

  const highConfidence: string[] = [];
  const suggestions: string[] = [];

  for (const obs of dedupMap.values()) {
    const effConf = effectiveConfidence(obs);
    if (effConf < 5) continue; // skip low-confidence

    const line = [
      `- ${obs.parameter}: system default ${obs.default_value} → learned ${obs.user_value}`,
      `(n=${obs.sample_size}, σ=±${obs.std_dev}, delivery=${(obs.outcome.delivery_rate * 100).toFixed(0)}%)`,
    ].join(" ");

    if (obs.sample_size >= 5 && obs.outcome.delivery_rate >= 0.85 && effConf >= 8) {
      highConfidence.push(line);
    } else {
      suggestions.push(line);
    }
  }

  const parts: string[] = [];

  if (highConfidence.length > 0) {
    parts.push("### High-confidence parameter defaults (use these values):");
    parts.push(...highConfidence);
  }

  if (suggestions.length > 0) {
    parts.push("### Parameter suggestions from user edits (consider these):");
    parts.push(...suggestions);
  }

  // Feature gaps
  const featureGaps = await loadFeatureGaps(family);
  if (featureGaps.length > 0) {
    parts.push("### Features users often add manually:");
    for (const gap of featureGaps) {
      parts.push(`- ${gap.requested_feature} (present in generation: ${gap.feature_present_in_gen ? "yes" : "no"}, user-added: ${gap.user_added_feature ? "yes" : "no"})`);
    }
  }

  // Validation patterns
  const validationPatterns = await loadValidationPatterns(family);
  if (validationPatterns.length > 0) {
    parts.push("### Common validation failures to avoid:");
    for (const vp of validationPatterns) {
      parts.push(`- ${vp.rule_name} (${vp.rule_id}): fails ${(vp.failure_rate * 100).toFixed(0)}% of the time, repair fixes ${(vp.repair_success_rate * 100).toFixed(0)}%`);
    }
  }

  return parts.join("\n");
}

async function loadFeatureGaps(
  family: string
): Promise<FeatureGapObservation[]> {
  const gaps: FeatureGapObservation[] = [];
  const seen = new Set<string>();

  try {
    const raw = await fs.readFile(OBSERVATIONS_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as FeatureGapObservation;
        if (obs.observation_type !== "feature_gap" || obs.family !== family) continue;
        const effConf = effectiveConfidence(obs);
        if (effConf < 5) continue;
        const key = obs.requested_feature;
        if (!seen.has(key)) {
          seen.add(key);
          gaps.push(obs);
        }
      } catch { /* skip */ }
    }
  } catch { /* file doesn't exist */ }

  return gaps.slice(0, 5);
}

async function loadValidationPatterns(
  family: string
): Promise<ValidationFailureObservation[]> {
  const patterns: ValidationFailureObservation[] = [];
  const seen = new Set<string>();

  try {
    const raw = await fs.readFile(OBSERVATIONS_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as ValidationFailureObservation;
        if (obs.observation_type !== "validation_failure" || obs.family !== family) continue;
        const effConf = effectiveConfidence(obs);
        if (effConf < 5) continue;
        if (obs.failure_rate < 0.1) continue; // skip rare failures
        const key = obs.rule_id;
        if (!seen.has(key)) {
          seen.add(key);
          patterns.push(obs);
        }
      } catch { /* skip */ }
    }
  } catch { /* file doesn't exist */ }

  return patterns.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Legacy API — kept for backward compatibility
// ---------------------------------------------------------------------------

export interface EditPattern {
  family: string;
  type: "parameter_drift" | "scad_patch" | "validation_failure";
  insight: string;
  frequency: number;
  parameter?: string;
  suggestedValue?: number;
  details: Record<string, unknown>;
}

/** @deprecated — use recordParameterDrift() instead */
export async function analyzeUserEdits(
  _sinceHours: number = 24
): Promise<EditPattern[]> {
  // v3.0: pipeline triggers handle this. Cron route still calls this
  // for backward compat but the implementation is simplified.
  return [];
}

/** @deprecated — observations are written via appendObservation() directly */
export async function writeLearnedPatterns(
  _patterns: EditPattern[]
): Promise<void> {
  // No-op in v3.0 — observations are append-only
}

/**
 * Legacy: format patterns as markdown for injection into prompts.
 * Falls back to v3.0 structured observations if they exist.
 */
export async function getLearnedPatternsForFamily(
  family: string
): Promise<string> {
  // Try v3.0 observations first
  const v3 = await getLearnedDefaultsForFamily(family);
  if (v3) return v3;

  // Fall back to legacy patterns file
  try {
    const raw = await fs.readFile(LEGACY_PATTERNS_PATH, "utf8");
    const data = JSON.parse(raw) as { patterns: EditPattern[] };
    const familyPatterns = data.patterns.filter((p) => p.family === family);
    if (familyPatterns.length === 0) return "";

    const lines: string[] = [];
    for (const type of ["parameter_drift", "scad_patch", "validation_failure"] as const) {
      const group = familyPatterns.filter((p) => p.type === type);
      if (group.length === 0) continue;
      const label = {
        parameter_drift: "### Common user adjustments:",
        scad_patch: "### Common SCAD source modifications:",
        validation_failure: "### Frequent validation failures:",
      }[type];
      lines.push(label);
      for (const p of group) lines.push(`- ${p.insight}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
