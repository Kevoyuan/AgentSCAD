/**
 * The measured-failure repair loop.
 *
 * A generation pipeline that only repairs validator complaints cannot fix a part
 * that compiles cleanly, renders, and still does not fit: the failure exists in
 * the geometry, not in the source. This loop closes that gap by re-measuring
 * after every proposal and feeding the numbers back.
 *
 * Four properties make it worth trusting:
 *
 * 1. Every attempt is measured with the same measurement closure. A repair
 *    cannot make a check pass by changing what is checked, because the loop
 *    never lets it near the measurement.
 * 2. A proposal is guarded against the declaration it replaces before it is
 *    measured at all. Deleting the bore is faster than widening it, so it is
 *    refused rather than rewarded.
 * 3. Every returned model proposal becomes its own recorded attempt, including
 *    one identical to the current source, one that breaks an invariant, one
 *    that cannot be rendered, and an empty or oversized reply. The attempt
 *    binds the exact returned bytes when they fit the 256 KiB limit, the byte
 *    count and SHA-256 always, and the provider/model/token usage when the
 *    model reported it. A paid call must never disappear from history.
 * 4. Stopping is always reported and never reads as success. Running out of
 *    attempts, getting the same source back, a repair that will not render and
 *    a cancelled run are distinct outcomes, and none of them is "done".
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
  /**
   * Exact returned model source, retained for byte-exact replay when it fits the
   * hard per-attempt limit. Absent only when the source was too large for the
   * policy or no source was returned at all.
   */
  candidateScadSource?: string;
  /**
   * Returned source byte count. Always recorded for a returned proposal, even
   * when the text is withheld by the 256 KiB policy.
   */
  candidateByteLength?: number;
  findings: AssemblyFinding[];
  evidence: { identity: string; assembly: string; motion: string };
  /** Empty for the original, and for a repair that kept the declaration intact. */
  violations: RepairViolation[];
  /** False when the declaration was weakened; such an attempt is never measured. */
  accepted: boolean;
  /**
   * Never infer progress from an empty findings array. A proposal that repeated
   * the current source, broke an invariant, failed to render, was rejected
   * before rendering, or was cancelled keeps its own non-success phase.
   */
  phase?: "measured" | "invariant" | "no-progress" | "proposal-error" | "measurement-error" | "aborted";
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
/**
 * Hard per-attempt candidate source bound. The append-only ledger enforces the
 * same limit; larger source is represented only by its digest and byte count.
 */
const MAX_CANDIDATE_SOURCE_BYTES = 256 * 1024;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Bind the exact returned bytes when they fit the hard limit. An oversized
 * proposal keeps its byte count and is represented by its SHA-256 only, so it
 * is never persisted as text and never rendered.
 */
function returnedSource(scad: string) {
  const candidateByteLength = Buffer.byteLength(scad, "utf8");
  return {
    candidateByteLength,
    ...(candidateByteLength <= MAX_CANDIDATE_SOURCE_BYTES ? { candidateScadSource: scad } : {}),
  };
}

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
  /**
   * Called and awaited after every recorded attempt, so append-only persistence
   * completes before the next potentially paid proposal starts.
   */
  onAttempt?: (attempt: RepairLoopAttempt) => unknown | Promise<unknown>;
}): Promise<RepairLoopResult> {
  const maxAttempts = Math.min(Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), HARD_MAX_ATTEMPTS);
  const attempts: RepairLoopAttempt[] = [];

  const record = async (attempt: RepairLoopAttempt) => {
    attempts.push(attempt);
    await input.onAttempt?.(attempt);
  };

  let measurement = await input.measure(input.scad);
  let findings = collectAssemblyFindings({
    manifest: measurement.manifest, fitRequirements: measurement.fitRequirements, kinematics: measurement.kinematics,
  });
  let currentScad = input.scad;
  await record({
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
      // No proposal was returned, so there is no candidate to bind or replay.
      // The terminal event of the run records the failure; fabricating an
      // attempt here would claim a candidate that never existed.
      return finish(input.signal?.aborted ? "aborted" : "repair-failed",
        `The repair call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (input.signal?.aborted) {
      const reason = "The repair execution was aborted after the model returned a proposal; it was not rendered.";
      await record({
        attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
        violations: [], accepted: false, phase: "aborted", reason,
        ...returnedSource(proposed),
        ...(modelExecution === undefined ? {} : { modelExecution }),
      });
      return finish("aborted", reason);
    }
    if (!proposed.trim() || Buffer.byteLength(proposed, "utf8") > MAX_CANDIDATE_SOURCE_BYTES) {
      const reason = proposed.trim()
        ? "The repaired source exceeded 256 KiB and was rejected before rendering."
        : "The repair returned empty source, so the previous candidate was kept.";
      await record({
        attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
        violations: [], accepted: false, phase: "proposal-error", reason,
        ...returnedSource(proposed),
        ...(modelExecution === undefined ? {} : { modelExecution }),
      });
      return finish("repair-failed", reason);
    }
    if (proposed.trim() === currentScad.trim()) {
      const reason = "The repair returned the source it was given, so re-measuring would repeat the same result.";
      await record({
        attempt, scadSha256: sha256(proposed), ...returnedSource(proposed),
        findings: [], evidence: evidenceOf(measurement.manifest),
        violations: [], accepted: false, phase: "no-progress", reason,
        ...(modelExecution === undefined ? {} : { modelExecution }),
      });
      return finish("no-progress", reason);
    }

    if (input.strictEmbeddedSpec === true) {
      // Guard the declaration before rendering it: a repair that weakens the
      // contract must be refused without spending a measurement.
      const extracted = extractEmbeddedAssemblySpec(proposed);
      if (extracted.status !== "valid") {
        const violation: RepairViolation = { code: "invalid", message: extracted.status === "invalid" ? extracted.reason : "The repaired source has no embedded declaration." };
        const reason = "The repaired source has no valid embedded assembly declaration.";
        await record({
          attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
          violations: [violation], accepted: false, phase: "invariant", reason,
          ...returnedSource(proposed),
          ...(modelExecution === undefined ? {} : { modelExecution }),
        });
        return finish("invariant-violated", reason);
      }
      const guard = assertRepairPreservesAssembly({ before: measurement.spec, after: extracted.spec, contract: input.contract });
      if (!guard.ok) {
        const reason = `The repair weakened the assembly instead of fixing it: ${guard.violations.map((violation) => violation.message).join(" ")}`;
        await record({
          attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
          violations: guard.violations, accepted: false, phase: "invariant", reason,
          ...returnedSource(proposed),
          ...(modelExecution === undefined ? {} : { modelExecution }),
        });
        return finish("invariant-violated", reason);
      }
    }

    // The proposal must be measured before it can be judged, but an invalid
    // declaration has already been refused above.
    let next: AssemblyMeasurement;
    try {
      next = await input.measure(proposed);
    } catch (error) {
      const aborted = input.signal?.aborted === true;
      const reason = aborted
        ? "The repair execution was aborted while measuring the returned proposal."
        : `The repaired source could not be measured: ${error instanceof Error ? error.message : String(error)}`;
      await record({
        attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
        violations: [], accepted: false, phase: aborted ? "aborted" : "measurement-error", reason,
        ...returnedSource(proposed),
        ...(modelExecution === undefined ? {} : { modelExecution }),
      });
      return finish(aborted ? "aborted" : "repair-failed", reason);
    }
    const violations = assertRepairPreservesAssembly({ before: measurement.spec, after: next.spec, contract: input.contract });
    if (!violations.ok) {
      const reason = `The repair weakened the assembly instead of fixing it: ${violations.violations.map((violation) => violation.message).join(" ")}`;
      await record({
        attempt, scadSha256: sha256(proposed), findings: [],
        evidence: evidenceOf(next.manifest), violations: violations.violations, accepted: false,
        phase: "invariant", reason,
        ...returnedSource(proposed),
        ...(modelExecution === undefined ? {} : { modelExecution }),
      });
      return finish("invariant-violated", reason);
    }

    const nextFindings = collectAssemblyFindings({
      manifest: next.manifest, fitRequirements: next.fitRequirements, kinematics: next.kinematics,
    });
    await record({
      attempt, scadSha256: sha256(proposed), findings: nextFindings,
      evidence: evidenceOf(next.manifest), violations: [], accepted: true, phase: "measured",
      ...returnedSource(proposed),
      ...(modelExecution === undefined ? {} : { modelExecution }),
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
