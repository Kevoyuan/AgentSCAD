import { getValidationEvidenceStatus } from "./evidence-status";

export type DeliveryReadinessStatus =
  | "pending"
  | "ready"
  | "review"
  | "blocked"
  | "unverified";

export type DeliveryReadinessAction =
  | "wait"
  | "process"
  | "reprocess"
  | "auto_repair"
  | "visual_repair"
  | "inspect_validation"
  | "export";

export interface DeliveryValidationResult {
  rule_id: string;
  rule_name: string;
  level: string;
  passed: boolean;
  is_critical: boolean;
  message: string;
  status?: import("./evidence-status").ValidationEvidenceStatus;
}

export interface DeliveryReadinessInput {
  state?: string | null;
  scadSource?: string | null;
  stlPath?: string | null;
  pngPath?: string | null;
  validationResults?: DeliveryValidationResult[] | null;
}

export interface DeliveryReadinessReport {
  status: DeliveryReadinessStatus;
  score: number;
  label: string;
  summary: string;
  nextAction: DeliveryReadinessAction;
  nextActionLabel: string;
  blockers: string[];
  warnings: string[];
  counts: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
    errors: number;
    notRun: number;
    criticalFailures: number;
    artifactsReady: number;
    artifactsTotal: number;
  };
}

const FAILED_STATES = new Set(["VALIDATION_FAILED", "GEOMETRY_FAILED", "RENDER_FAILED"]);
const ACTIVE_STATES = new Set(["SCAD_GENERATED", "RENDERED", "VALIDATED", "DEBUGGING", "REPAIRING"]);

export function isSkippedValidation(result: DeliveryValidationResult): boolean {
  return getValidationEvidenceStatus(result) === "SKIP";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function summarizeRule(result: DeliveryValidationResult): string {
  return `${result.rule_id} ${result.rule_name}: ${result.message}`;
}

export function buildDeliveryReadiness(input: DeliveryReadinessInput): DeliveryReadinessReport {
  const state = input.state || "NEW";
  const validationResults = input.validationResults ?? [];
  const statusOf = (result: DeliveryValidationResult) => getValidationEvidenceStatus(result);
  const passed = validationResults.filter((result) => statusOf(result) === "PASS");
  const evidenceWarnings = validationResults.filter((result) => statusOf(result) === "WARN");
  const failed = validationResults.filter((result) => statusOf(result) === "FAIL");
  const skipped = validationResults.filter((result) => statusOf(result) === "SKIP");
  const errors = validationResults.filter((result) => statusOf(result) === "ERROR");
  const notRun = validationResults.filter((result) => statusOf(result) === "NOT_RUN");
  const unresolved = [...skipped, ...errors, ...notRun];
  const actionable = [...passed, ...evidenceWarnings, ...failed];
  const criticalFailures = failed.filter((result) => result.is_critical);

  const artifactChecks = [
    { label: "SCAD source", ok: Boolean(input.scadSource) },
    { label: "STL artifact", ok: Boolean(input.stlPath) },
    { label: "Preview image", ok: Boolean(input.pngPath) },
  ];
  const missingArtifacts = artifactChecks.filter((check) => !check.ok).map((check) => check.label);
  const artifactsReady = artifactChecks.length - missingArtifacts.length;
  const hasAnyArtifact = artifactsReady > 0;
  const hasAllArtifacts = missingArtifacts.length === 0;

  const artifactScore = artifactsReady / artifactChecks.length;
  const actionableScore = actionable.length > 0
    ? (passed.length + evidenceWarnings.length * 0.5) / actionable.length
    : 0;
  const certaintyScore = validationResults.length > 0
    ? 1 - unresolved.length / validationResults.length
    : 0;
  let score = clampScore(artifactScore * 0.35 + actionableScore * 0.5 + certaintyScore * 0.15);

  const blockers = [
    ...missingArtifacts.map((artifact) => `${artifact} is missing`),
    ...criticalFailures.map(summarizeRule),
  ];
  const warnings = [
    ...evidenceWarnings.map(summarizeRule),
    ...failed.filter((result) => !result.is_critical).map(summarizeRule),
    ...unresolved.map(summarizeRule),
  ];
  const counts = {
    total: validationResults.length,
    passed: passed.length,
    warnings: evidenceWarnings.length,
    failed: failed.length,
    skipped: skipped.length,
    errors: errors.length,
    notRun: notRun.length,
    criticalFailures: criticalFailures.length,
    artifactsReady,
    artifactsTotal: artifactChecks.length,
  };

  if (state === "NEW" && !hasAnyArtifact) {
    return {
      status: "pending",
      score: 0,
      label: "Ready to process",
      summary: "No CAD artifacts exist yet. Run the pipeline to generate SCAD, STL, preview, and validation.",
      nextAction: "process",
      nextActionLabel: "Process Job",
      blockers: [],
      warnings: [],
      counts,
    };
  }

  if (ACTIVE_STATES.has(state) && !FAILED_STATES.has(state)) {
    return {
      status: "pending",
      score,
      label: "Pipeline running",
      summary: "The job is still moving through generation, render, validation, or repair.",
      nextAction: "wait",
      nextActionLabel: "Wait",
      blockers: [],
      warnings,
      counts,
    };
  }

  if (FAILED_STATES.has(state) || criticalFailures.length > 0) {
    score = Math.min(score, 0.55);
    return {
      status: "blocked",
      score,
      label: "Blocked",
      summary: criticalFailures.length > 0
        ? `${criticalFailures.length} critical validation check${criticalFailures.length === 1 ? "" : "s"} failed.`
        : "The CAD pipeline failed before a trusted deliverable was produced.",
      nextAction: input.scadSource ? "auto_repair" : "reprocess",
      nextActionLabel: input.scadSource ? "Auto Repair" : "Reprocess",
      blockers,
      warnings,
      counts,
    };
  }

  if (!hasAllArtifacts) {
    score = Math.min(score, 0.45);
    return {
      status: "unverified",
      score,
      label: "Artifacts incomplete",
      summary: `${missingArtifacts.join(", ")} ${missingArtifacts.length === 1 ? "is" : "are"} missing.`,
      nextAction: "reprocess",
      nextActionLabel: "Rebuild STL",
      blockers,
      warnings,
      counts,
    };
  }

  if (validationResults.length === 0 || actionable.length === 0) {
    score = Math.min(score, 0.6);
    return {
      status: "unverified",
      score,
      label: "Validation missing",
      summary: "Artifacts exist, but no actionable validation evidence is available yet.",
      nextAction: "inspect_validation",
      nextActionLabel: "Inspect Validation",
      blockers: [],
      warnings,
      counts,
    };
  }

  if (failed.length > 0 || evidenceWarnings.length > 0 || unresolved.length > 0 || state === "HUMAN_REVIEW") {
    score = Math.min(score, unresolved.length > 0 ? 0.82 : 0.9);
    const hasVisualOrSemanticSkipped = unresolved.some((result) =>
      result.rule_id.startsWith("V") || result.rule_id.startsWith("S")
    );

    return {
      status: "review",
      score,
      label: "Review before printing",
      summary: unresolved.length > 0
        ? `${unresolved.length} validation check${unresolved.length === 1 ? "" : "s"} did not produce conclusive evidence, so the result is not fully proven.`
        : `${failed.length + evidenceWarnings.length} non-critical validation warning${failed.length + evidenceWarnings.length === 1 ? "" : "s"} need review.`,
      nextAction: hasVisualOrSemanticSkipped ? "visual_repair" : "inspect_validation",
      nextActionLabel: hasVisualOrSemanticSkipped ? "Run Visual Check" : "Inspect Validation",
      blockers: [],
      warnings,
      counts,
    };
  }

  return {
    status: "ready",
    score: 1,
    label: "Export-ready",
    summary: "SCAD, STL, preview, and actionable validation checks are all present with no failures.",
    nextAction: "export",
    nextActionLabel: "Export",
    blockers: [],
    warnings: [],
    counts,
  };
}
