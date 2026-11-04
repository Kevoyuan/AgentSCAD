/**
 * Turns measured assembly failures into repair input, and checks that a repair
 * did not weaken the contract to make the failure go away.
 *
 * Two rules shape this module:
 *
 * 1. A finding carries numbers, not adjectives. "Clearance is wrong" gives a
 *    model nothing to act on; "measured 0.400–0.415 mm, required 0.100–0.300 mm,
 *    connection hinge" does.
 * 2. A repair may fix geometry. It may not delete a part, drop a joint, shrink
 *    a declared range or rename the bore side. Those are the cheap ways to make
 *    a check pass without making the part work, so they are rejected after the
 *    fact rather than trusted beforehand.
 */
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import type { DisassemblyPathEvidence, MotionRangeEvidence } from "./path-and-motion";
import type { RequirementContract } from "../requirements/requirement-contract";
import type { AssemblyFitRequirement } from "./prepare-assembly";

export type FindingKind = "identity" | "fit" | "path" | "motion";

export interface AssemblyFinding {
  kind: FindingKind;
  layer: "identity" | "assembly" | "motion";
  /** Concrete subject, so a repair knows exactly what to change. */
  connectionId: string | null;
  instanceIds: string[];
  /** Numbers that were measured, when the check produced numbers. */
  measured: string | null;
  /** Numbers the contract or declaration asked for. */
  required: string | null;
  /** Where the failure happened, in mm along the axis or degrees of rotation. */
  atMm: number | null;
  atDeg: number | null;
  /** One actionable sentence. */
  message: string;
}

/**
 * Fixed precision, not full float. A finding is read by a model and by a person;
 * "0.392–0.407 mm against 0.100–0.300 mm" is actionable, sixteen digits are noise.
 * The precision is stated by the unit so both sides of the comparison line up.
 */
const precisionFor = (unit: string) => (unit === "deg" ? 2 : 3);
const formatRange = (value: { min: number; max: number }, unit: string) => {
  const digits = precisionFor(unit);
  return `${value.min.toFixed(digits)}–${value.max.toFixed(digits)} ${unit}`;
};

/**
 * The parts of a prepared manifest the findings are read from. Named so the
 * repair loop and the tests agree on the shape without importing the whole
 * manifest type.
 */
export interface AssemblyEvidenceManifest {
  evidence: Record<string, { status: string; reason: string }>;
  contract?: { evidenceCurrent: boolean | null };
  fits: Array<{
    connectionId: string;
    status: string;
    reason: string;
    measuredStatus: string;
    diametralClearanceMm: { min: number; max: number } | null;
    boreDiameterMm: { min: number; max: number } | null;
    shaftDiameterMm: { min: number; max: number } | null;
  }>;
}

/**
 * Reads the evidence that was actually produced and keeps only the failures.
 * A layer that was not measured produces no finding: repairing a guess is worse
 * than leaving it alone.
 */
export function collectAssemblyFindings(input: {
  manifest: AssemblyEvidenceManifest;
  fitRequirements?: AssemblyFitRequirement[];
  kinematics: { path: DisassemblyPathEvidence; motion: MotionRangeEvidence } | null;
}): AssemblyFinding[] {
  const findings: AssemblyFinding[] = [];
  const identity = input.manifest.evidence.identity;
  if (identity?.status === "FAIL") {
    findings.push({
      kind: "identity", layer: "identity", connectionId: null, instanceIds: [],
      measured: null, required: null, atMm: null, atDeg: null,
      message: `The parts are not independently selectable: ${identity.reason}`,
    });
  }

  const requirementById = new Map((input.fitRequirements ?? []).map((requirement) => [requirement.connectionId, requirement]));
  /**
   * A measurement that failed is still a failure when the contract behind it is
   * unconfirmed — only its standing as a verdict changes. The finding is
   * emitted anyway, because the alternative is shipping a part that measurably
   * does not fit, but the band it is compared against is labelled as
   * provisional so the repair is not told a guess is a requirement.
   */
  const provisional = input.manifest.contract?.evidenceCurrent === false
    ? " The requirement band is not from a confirmed contract; treat it as provisional."
    : "";
  for (const fit of input.manifest.fits) {
    if (fit.measuredStatus !== "FAIL") continue;
    const requirement = requirementById.get(fit.connectionId);
    const measured = fit.diametralClearanceMm ? formatRange(fit.diametralClearanceMm, "mm") : null;
    const required = requirement?.diametralClearanceMm ? formatRange(requirement.diametralClearanceMm, "mm") : null;
    findings.push({
      kind: "fit", layer: "assembly", connectionId: fit.connectionId,
      instanceIds: requirement?.boreInstanceId ? [requirement.boreInstanceId] : [],
      measured, required, atMm: null, atDeg: null,
      // `fit.reason` restates the same two numbers, so it is not appended: the
      // message and the fields below it would say the same thing twice.
      message: `The measured diametral clearance (${measured ?? "unknown"}) is outside the required band (${required ?? "unknown"}).${provisional}`,
    });
  }

  if (input.kinematics?.path.status === "FAIL") {
    const blocked = input.kinematics.path.blockedAt;
    const pair = blocked?.blocking[0];
    findings.push({
      kind: "path", layer: "assembly", connectionId: input.kinematics.path.connectionId,
      instanceIds: pair ? [pair.movingInstanceId, pair.otherInstanceId] : [],
      measured: blocked ? `blocked at ${blocked.offsetMm.toFixed(3)} mm along the axis` : null,
      required: "an unobstructed straight path along the joint axis",
      atMm: blocked?.offsetMm ?? null, atDeg: null,
      message: pair
        ? `Sliding the moving part out along the joint axis is blocked at ${blocked!.offsetMm.toFixed(3)} mm: ${pair.movingInstanceId} interferes with ${pair.otherInstanceId}. ${pair.reason}`
        : input.kinematics.path.reason,
    });
  }

  if (input.kinematics?.motion.status === "FAIL") {
    const blocked = input.kinematics.motion.blockedAt;
    const pair = blocked?.blocking[0];
    findings.push({
      kind: "motion", layer: "motion", connectionId: input.kinematics.motion.connectionId,
      instanceIds: pair ? [pair.movingInstanceId, pair.otherInstanceId] : [],
      measured: blocked ? `blocked at ${blocked.angleDeg.toFixed(2)}°` : null,
      required: input.kinematics.motion.rangeDeg ? formatRange(input.kinematics.motion.rangeDeg, "deg") : null,
      atMm: null, atDeg: blocked?.angleDeg ?? null,
      message: pair
        ? `Rotating through the declared range is blocked at ${blocked!.angleDeg.toFixed(2)}°: ${pair.movingInstanceId} interferes with ${pair.otherInstanceId}. ${pair.reason}`
        : input.kinematics.motion.reason,
    });
  }
  return findings;
}

/**
 * The rules a repair must not break. Shared by both prompt builders so the
 * assembly repair and the general repair state the same contract.
 */
export const ASSEMBLY_REPAIR_INVARIANTS: readonly string[] = [
  "Keep every part, instance and connection listed above. Do not merge two parts into one, do not drop a joint, do not rename an instance.",
  "Do not change the declared motion range to a smaller one.",
  "Do not change which instance carries the bore.",
  "Do not change the requirement. The requirement belongs to the user; only the geometry may change.",
  "If a failure cannot be fixed without breaking an invariant, say so and leave the source unchanged. A wrong part that reports its own defect is better than a part that hides it.",
];

/** The numbered failure list, with the numbers a repair needs to aim at. */
export function renderAssemblyFindings(findings: AssemblyFinding[]): string {
  return findings.map((finding, index) => [
    `${index + 1}. [${finding.layer}] ${finding.message}`,
    finding.measured ? `   measured: ${finding.measured}` : null,
    finding.required ? `   required: ${finding.required}` : null,
    finding.instanceIds.length > 0 ? `   instances: ${finding.instanceIds.join(", ")}` : null,
    finding.connectionId ? `   connection: ${finding.connectionId}` : null,
  ].filter(Boolean).join("\n")).join("\n");
}

/**
 * The prompt asks for a geometry fix and states the invariants the reply will be
 * checked against, so a model that would rather delete the joint knows up front
 * that it will be rejected.
 */
export function buildAssemblyRepairPrompt(input: {
  originalRequest: string;
  spec: AssemblySpec;
  findings: AssemblyFinding[];
  currentScad: string;
}): string {
  const findings = renderAssemblyFindings(input.findings);

  return [
    "## Original Request",
    input.originalRequest,
    "",
    "## What Failed (measured, not guessed)",
    findings || "(no measured failures)",
    "",
    "## Current SCAD Source",
    "```scad",
    input.currentScad,
    "```",
    "",
    "## Declared Assembly (must be preserved)",
    `parts: ${input.spec.parts.map((part) => part.id).join(", ")}`,
    `instances: ${input.spec.instances.map((instance) => instance.id).join(", ")}`,
    `connections: ${input.spec.connections.map((connection) => `${connection.id} (${connection.type}, ${connection.a} ↔ ${connection.b})`).join("; ") || "(none)"}`,
    "",
    "## Repair Goal",
    "Fix the geometry so the listed measurements fall inside their requirements.",
    "",
    "Invariants — a reply that breaks any of these is rejected, not reviewed:",
    ...ASSEMBLY_REPAIR_INVARIANTS.map((rule) => `- ${rule}`),
    "",
    "Return the complete corrected SCAD source in a single fenced block.",
  ].join("\n");
}

export interface RepairViolation {
  code: "part-removed" | "instance-removed" | "connection-removed" | "connection-changed" | "range-shrunk" | "bore-changed" | "invalid" | "requirement-relaxed";
  message: string;
}

/**
 * Checks a repaired declaration against the one it replaced and against the
 * contract. Returns every violation rather than the first, so a user can see all
 * of what was weakened instead of fixing them one at a time.
 */
export function assertRepairPreservesAssembly(input: {
  before: unknown;
  after: unknown;
  contract?: RequirementContract | null;
}): { ok: boolean; violations: RepairViolation[] } {
  const violations: RepairViolation[] = [];
  const before = validateAssemblySpec(input.before);
  const after = validateAssemblySpec(input.after);
  if (!before.success) return { ok: false, violations: [{ code: "invalid", message: `The original declaration is invalid: ${before.error.issues[0]?.message ?? "unknown"}` }] };
  if (!after.success) return { ok: false, violations: [{ code: "invalid", message: `The repaired declaration is invalid: ${after.error.issues[0]?.message ?? "unknown"}` }] };

  const afterParts = new Set(after.data.parts.map((part) => part.id));
  for (const part of before.data.parts) {
    if (!afterParts.has(part.id)) violations.push({ code: "part-removed", message: `Part "${part.id}" was removed.` });
  }
  const afterInstances = new Set(after.data.instances.map((instance) => instance.id));
  for (const instance of before.data.instances) {
    if (!afterInstances.has(instance.id)) violations.push({ code: "instance-removed", message: `Instance "${instance.id}" was removed.` });
  }
  const afterConnections = new Map(after.data.connections.map((connection) => [connection.id, connection]));
  for (const connection of before.data.connections) {
    const repaired = afterConnections.get(connection.id);
    if (!repaired) {
      violations.push({ code: "connection-removed", message: `Connection "${connection.id}" was removed.` });
      continue;
    }
    if (repaired.a !== connection.a || repaired.b !== connection.b || repaired.type !== connection.type) {
      violations.push({ code: "connection-changed", message: `Connection "${connection.id}" changed its instances or type.` });
    }
    if (connection.range && repaired.range) {
      const shrunk = repaired.range.max < connection.range.max || repaired.range.min > connection.range.min || repaired.range.unit !== connection.range.unit;
      if (shrunk) {
        violations.push({ code: "range-shrunk", message: `Connection "${connection.id}" narrowed its range from ${connection.range.min}..${connection.range.max} ${connection.range.unit} to ${repaired.range.min}..${repaired.range.max} ${repaired.range.unit}.` });
      }
    } else if (connection.range && !repaired.range) {
      violations.push({ code: "range-shrunk", message: `Connection "${connection.id}" dropped its declared range.` });
    }
    if ((connection.boreInstanceId ?? null) !== (repaired.boreInstanceId ?? null)) {
      violations.push({ code: "bore-changed", message: `Connection "${connection.id}" changed which instance carries the bore.` });
    }
  }

  // A repair may not answer a "must reach at least N" assertion by leaving the
  // declaration short of N. `range-shrunk` above only catches a range that got
  // smaller during the repair; this catches one that was already too small and
  // stayed that way.
  const reach = input.contract?.requirements.find((requirement) => requirement.id === "motion-range-deg");
  const expected = reach?.expected;
  if (expected && expected.kind === "atLeast") {
    const declared = after.data.connections
      .filter((connection) => connection.range?.unit === expected.unit)
      .map((connection) => Math.max(Math.abs(connection.range!.min), Math.abs(connection.range!.max)));
    // Several joints may carry a range; the assembly is only short if none of
    // them reaches the requested angle.
    if (declared.length > 0 && Math.max(...declared) < expected.min) {
      const achieved = Math.max(...declared);
      violations.push({ code: "requirement-relaxed", message: `The repaired declaration reaches ${achieved} ${expected.unit} but the contract requires at least ${expected.min} ${expected.unit}.` });
    }
  }

  return { ok: violations.length === 0, violations };
}
