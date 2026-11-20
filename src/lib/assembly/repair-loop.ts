/**
 * The measured-failure repair loop.
 *
 * A generation pipeline that only repairs validator complaints cannot fix a part
 * that compiles cleanly, renders, and still does not fit: the failure exists in
 * the geometry, not in the source. This loop closes that gap by re-measuring
 * after every proposal and feeding the numbers back.
 *
 * Three properties make it worth trusting:
 *
 * 1. Every attempt is measured with the same measurement closure. A repair
 *    cannot make a check pass by changing what is checked, because the loop
 *    never lets it near the measurement.
 * 2. A proposal is guarded against the declaration it replaces before it is
 *    measured at all. Deleting the bore is faster than widening it, so it is
 *    refused rather than rewarded.
 * 3. Stopping is always reported. Running out of attempts, getting the same
 *    source back, or a repair that will not render are three different outcomes,
 *    and none of them is "done".
 */
import { assertRepairPreservesAssembly, buildAssemblyRepairPrompt, collectAssemblyFindings, type AssemblyEvidenceManifest, type AssemblyFinding, type RepairViolation } from "./repair-findings";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";
import type { DisassemblyPathEvidence, MotionRangeEvidence } from "./path-and-motion";
import type { RequirementContract } from "../requirements/requirement-contract";
import type { AssemblyFitRequirement } from "./prepare-assembly";
import { createHash } from "crypto";

/** Everything the loop needs to know about one measured candidate. */
export interface AssemblyMeasurement {
  /** The declaration this source is supposed to implement; guarded between attempts. */
  spec: unknown;
  manifest: AssemblyEvidenceManifest;
  kinematics: { path: DisassemblyPathEvidence; motion: MotionRangeEvidence } | null;
  fitRequirements?: AssemblyFitRequirement[];
}

export interface RepairLoopAttempt {
  /** 0 is the candidate as generated; each repair increments it. */
  attempt: number;
  scadSha256: string;
  findings: AssemblyFinding[];
  evidence: { identity: string; assembly: string; motion: string };
  /** Empty for the original, and for a repair that kept the declaration intact. */
  violations: RepairViolation[];
  /** False when the declaration was weakened; such an attempt is never measured. */
  accepted: boolean;
  phase?: string;
  reason?: string;
  modelExecution?: unknown;
}

export type RepairLoopStop =
  /** Nothing measured failed, so there was nothing to repair. */
  | "no-findings"
  /** The attempt budget ran out with failures still measured. */
  | "attempt-budget"
  /** The proposal removed a part, a joint, a range or the bore. */
  | "invariant-violated"
  /** The proposal returned the source it was given. */
  | "no-progress"
  /** The proposal could not be measured, or the model call failed. */
  | "repair-failed"
  | "aborted"
  | "incomplete-evidence";

export interface RepairLoopResult {
  attempts: RepairLoopAttempt[];
  /** The last measurement that actually succeeded — never a discarded proposal. */
  final: AssemblyMeasurement;
  /** Failures still measured at the end; empty only when the loop closed them. */
  findings: AssemblyFinding[];
  stoppedBecause: RepairLoopStop;
  reason: string;
  finalScad?: string;
  finalScadSha256?: string;
  evidenceComplete?: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const HARD_MAX_ATTEMPTS = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function evidenceOf(manifest: AssemblyEvidenceManifest) {
  return {
    identity: manifest.evidence.identity?.status ?? "NOT_RUN",
    assembly: manifest.evidence.assembly?.status ?? "NOT_RUN",
    motion: manifest.evidence.motion?.status ?? "NOT_RUN",
  };
}

/**
 * Measure, repair, measure again until nothing measured fails or the budget runs
 * out. The caller supplies `measure` and `propose`; the loop supplies the order,
 * the guard and the record.
 */
export async function repairMeasuredFailures(input: {
  originalRequest: string;
  scad: string;
  /** Total repair proposals allowed. Default 2, capped at 5 so a bad prompt cannot loop forever. */
  maxAttempts?: number;
  /** Fixed for the whole run: the loop never measures with anything else. */
  measure: (scad: string) => Promise<AssemblyMeasurement>;
  /** One model call. Returning the same source ends the loop as `no-progress`. */
  propose: (prompt: string, attempt: number, context?: { currentScad: string; findings: AssemblyFinding[]; prompt: string; attempt: number; signal?: AbortSignal }) => Promise<{ scad: string; modelExecution?: unknown }>;
  contract?: RequirementContract | null;
  signal?: AbortSignal;
  strictEmbeddedSpec?: boolean;
  maxWallMs?: number;
  /** Called after every attempt is recorded, so a caller can stream progress. */
  onAttempt?: (attempt: RepairLoopAttempt) => void;
}): Promise<RepairLoopResult> {
  const maxAttempts = Math.min(Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), HARD_MAX_ATTEMPTS);
  const attempts: RepairLoopAttempt[] = [];

  const record = (attempt: RepairLoopAttempt) => {
    attempts.push(attempt);
    input.onAttempt?.(attempt);
  };

  let measurement = await input.measure(input.scad);
  let findings = collectAssemblyFindings({
    manifest: measurement.manifest, fitRequirements: measurement.fitRequirements, kinematics: measurement.kinematics,
  });
  let currentScad = input.scad;
  record({
    attempt: 0, scadSha256: sha256(currentScad), findings,
    evidence: evidenceOf(measurement.manifest), violations: [], accepted: true, phase: "measured",
  });

  const finish = (stoppedBecause: RepairLoopStop, reason: string): RepairLoopResult =>
    ({ attempts, final: measurement, findings, stoppedBecause, reason, finalScad: currentScad, finalScadSha256: sha256(currentScad), evidenceComplete: findings.length === 0 && Object.values(measurement.manifest.evidence ?? {}).every((item) => item.status === "PASS") });

  if (findings.length === 0) {
    const incomplete = input.strictEmbeddedSpec === true && Object.values(measurement.manifest.evidence ?? {}).some((item) => item.status === "NOT_RUN");
    if (incomplete) return finish("incomplete-evidence", "The measurement is inconclusive, so no repair call is made.");
    return finish("no-findings", "No measured check failed, so nothing was repaired.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    input.signal?.throwIfAborted();
    const prompt = buildAssemblyRepairPrompt({
      originalRequest: input.originalRequest,
      spec: measurement.spec as never,
      findings,
      currentScad,
    });

    let proposed: string;
    let modelExecution: unknown;
    try {
      const proposal = await input.propose(prompt, attempt, { currentScad, findings, prompt, attempt, signal: input.signal });
      proposed = proposal.scad;
      modelExecution = proposal.modelExecution;
    } catch (error) {
      return finish("repair-failed", `The repair call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!proposed.trim()) {
      return finish("repair-failed", "The repair returned empty source, so the previous candidate was kept.");
    }
    if (proposed.trim() === currentScad.trim()) {
      return finish("no-progress", "The repair returned the source it was given, so re-measuring would repeat the same result.");
    }

    if (input.strictEmbeddedSpec === true) {
      // Guard the declaration before rendering it: a repair that weakens the
      // contract must be refused without spending a measurement.
      const extracted = extractEmbeddedAssemblySpec(proposed);
      if (extracted.status !== "valid") {
        record({ attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest), violations: [{ code: "invalid", message: extracted.status === "invalid" ? extracted.reason : "The repaired source has no embedded declaration." }], accepted: false, phase: "invariant" });
        return finish("invariant-violated", "The repaired source has no valid embedded assembly declaration.");
      }
      const guard = assertRepairPreservesAssembly({ before: measurement.spec, after: extracted.spec, contract: input.contract });
      if (!guard.ok) {
        record({ attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest), violations: guard.violations, accepted: false, phase: "invariant" });
        return finish("invariant-violated", `The repair weakened the assembly instead of fixing it: ${guard.violations.map((violation) => violation.message).join(" ")}`);
      }

    }

    // The proposal must be measured before it can be judged, but an invalid
    // declaration has already been refused above.
    let next: AssemblyMeasurement;
    try {
      next = await input.measure(proposed);
    } catch (error) {
      return finish("repair-failed", `The repaired source could not be measured: ${error instanceof Error ? error.message : String(error)}`);
    }
    const violations = assertRepairPreservesAssembly({ before: measurement.spec, after: next.spec, contract: input.contract });
    if (!violations.ok) {
      record({
        attempt, scadSha256: sha256(proposed), findings: [],
        evidence: evidenceOf(next.manifest), violations: violations.violations, accepted: false, phase: "invariant",
      });
      return finish("invariant-violated", `The repair weakened the assembly instead of fixing it: ${violations.violations.map((violation) => violation.message).join(" ")}`);
    }

    const nextFindings = collectAssemblyFindings({
      manifest: next.manifest, fitRequirements: next.fitRequirements, kinematics: next.kinematics,
    });
    record({
      attempt, scadSha256: sha256(proposed), findings: nextFindings,
      evidence: evidenceOf(next.manifest), violations: [], accepted: true, phase: "measured", ...(modelExecution === undefined ? {} : { modelExecution }),
    });
    measurement = next;
    findings = nextFindings;
    currentScad = proposed;

    if (findings.length === 0) {
      return finish("no-findings", `Attempt ${attempt} closed every measured failure.`);
    }
  }

  return finish("attempt-budget", `Still ${findings.length} measured failure(s) after ${maxAttempts} repair attempt(s).`);
}
