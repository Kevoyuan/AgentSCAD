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
import type { DisassemblyPathEvidence, MotionRangeEvidence } from "./path-and-motion";
import type { RequirementContract } from "../requirements/requirement-contract";
import type { AssemblyFitRequirement } from "./prepare-assembly";
import { createHash } from "crypto";
import { canonicalJson } from "../canonical-json";
import { extractEmbeddedAssemblySpec } from "./embedded-spec";
import { assemblySpecificationHash } from "./spec-hash";

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
  /** Returned source is persisted for exact replay when at most 256 KiB. */
  candidateScadSource?: string;
  /** Always record byte count even for an oversized proposal withheld by policy. */
  candidateByteLength?: number;
  findings: AssemblyFinding[];
  evidence: { identity: string; assembly: string; motion: string };
  /** Empty for the original, and for a repair that kept the declaration intact. */
  violations: RepairViolation[];
  /** False when the declaration was weakened; such an attempt is never measured. */
  accepted: boolean;
  /** Never infer an unmeasured attempt from an empty findings array. */
  phase?: "measured" | "rejected-before-render" | "measurement-error" | "proposal-error" | "no-progress" | "aborted";
  reason?: string;
  measuredAt?: string;
  /** Frozen fit requirement hash, not candidate-selected measurement targets. */
  frozenRequirementsSha256?: string;
  /** Actual model usage when a proposal was returned; never invent euro charges. */
  measurementProvenance?: {
    sourceSha256:string;
    specificationSha256:string;
    partArtifactSha256:Record<string,string>;
    manifestSha256:string;
  };
  modelExecution?: {
    model: string;
    provider: string;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
  };
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
  /** Source of the last successfully measured and accepted candidate. */
  finalScad: string;
  finalScadSha256: string;
  /** A run can have no measured FAIL while still having missing checks. */
  evidenceComplete: boolean;
  /** Every accepted/rejected proposal retains a bounded, signed-by-content observation. */
  frozenRequirementsSha256: string;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const HARD_MAX_ATTEMPTS = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_SOURCE_BYTES = 256 * 1024;
const returnedSource = (scad: string) => ({
  candidateByteLength: Buffer.byteLength(scad,"utf8"),
  ...(Buffer.byteLength(scad,"utf8")<=MAX_SOURCE_BYTES ? { candidateScadSource:scad } : {}),
});
const MAX_REPAIR_WALL_MS = 240_000;
const requiredStatuses = ["identity", "assembly", "motion"] as const;
function evidenceComplete(manifest: AssemblyEvidenceManifest): boolean {
  return requiredStatuses.every(layer => manifest.evidence[layer]?.status === "PASS");
}
function frozenFitHash(value: AssemblyFitRequirement[] | undefined) {
  return sha256(canonicalJson(value ?? []));
}
function provenanceOf(measurement:AssemblyMeasurement):RepairLoopAttempt["measurementProvenance"]{
  const manifest=measurement.manifest as AssemblyEvidenceManifest & {
    sourceSha256?:string;specificationSha256?:string;
    parts?:Array<{id:string;artifactSha256:string|null}>;
  };
  if(!/^[a-f0-9]{64}$/.test(manifest.sourceSha256??"")||
     !/^[a-f0-9]{64}$/.test(manifest.specificationSha256??""))return undefined;
  return {
    sourceSha256:manifest.sourceSha256!,
    specificationSha256:manifest.specificationSha256!,
    partArtifactSha256:Object.fromEntries((manifest.parts??[]).filter(p=>p.artifactSha256).map(p=>[p.id,p.artifactSha256!])),
    manifestSha256:sha256(canonicalJson(manifest)),
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
  propose: (prompt: string, attempt: number, context?: { currentScad: string; findings: AssemblyFinding[] }) => Promise<{
    scad: string;
    modelExecution?: RepairLoopAttempt["modelExecution"];
  }>;
  contract?: RequirementContract | null;
  signal?: AbortSignal;
  /**
   * Require source-embedded declaration to match the originally measured spec
   * byte-for-byte in canonical meaning before every candidate render.
   * Production MUST set true; legacy pure unit/fixture repair remains compatible.
   */
  strictEmbeddedSpec?: boolean;
  maxWallMs?: number;
  /** Called and awaited after each attempt, suitable for append-only persistence. */
  onAttempt?: (attempt: RepairLoopAttempt) => unknown | Promise<unknown>;
}): Promise<RepairLoopResult> {
  const maxAttempts = Math.min(Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), HARD_MAX_ATTEMPTS);
  const started = performance.now();
  const wallMs = input.maxWallMs ?? MAX_REPAIR_WALL_MS;
  if (!Number.isSafeInteger(wallMs) || wallMs < 1 || wallMs > MAX_REPAIR_WALL_MS) throw new Error("Invalid repair execution budget");
  if (Buffer.byteLength(input.scad, "utf8") > MAX_SOURCE_BYTES) throw new Error("Original assembly source exceeds 256 KiB repair limit");
  const attempts: RepairLoopAttempt[] = [];
  const record = async (attempt: RepairLoopAttempt) => {
    attempts.push(attempt);
    await input.onAttempt?.(attempt);
  };
  const expired = () => input.signal?.aborted || performance.now()-started >= wallMs;
  const stopped = () => input.signal?.aborted ? "Job or repair execution was aborted" : "Total repair execution time budget exhausted";
  if (expired()) throw new Error(stopped());
  let measurement = await input.measure(input.scad);
  const originalSpecHash = assemblySpecificationHash(measurement.spec as never);
  const originalEmbedded = input.strictEmbeddedSpec ? extractEmbeddedAssemblySpec(input.scad) : null;
  if (input.strictEmbeddedSpec && (
    originalEmbedded?.status !== "valid" ||
    assemblySpecificationHash(originalEmbedded.spec) !== originalSpecHash
  )) throw new Error("Original assembly source lacks the exact frozen embedded specification");
  const frozenRequirements = measurement.fitRequirements;
  const frozenRequirementsSha256 = frozenFitHash(frozenRequirements);
  let findings = collectAssemblyFindings({
    manifest: measurement.manifest, fitRequirements: measurement.fitRequirements, kinematics: measurement.kinematics,
  });
  let currentScad = input.scad;
  await record({
    attempt: 0, scadSha256: sha256(currentScad), findings,
    evidence: evidenceOf(measurement.manifest), violations: [], accepted: true,
    phase: "measured", measuredAt: new Date().toISOString(), frozenRequirementsSha256,
    measurementProvenance:provenanceOf(measurement),
  });

  const finish = (stoppedBecause: RepairLoopStop, reason: string): RepairLoopResult =>
    ({ attempts, final: measurement, findings, stoppedBecause, reason,
      finalScad: currentScad, finalScadSha256: sha256(currentScad),
      frozenRequirementsSha256, evidenceComplete: evidenceComplete(measurement.manifest) });

  if (findings.length === 0) {
    return evidenceComplete(measurement.manifest)
      ? finish("no-findings", "All applicable measured layers passed; nothing was repaired.")
      : finish("incomplete-evidence", "No measured FAIL was available, but some required geometry checks are not PASS. No repair or approval was manufactured.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (expired()) return finish("aborted", stopped());
    const prompt = buildAssemblyRepairPrompt({
      originalRequest: input.originalRequest,
      spec: measurement.spec as never,
      findings,
      currentScad,
    });

    let proposed: string;
    let modelExecution: RepairLoopAttempt["modelExecution"];
    try {
      const reply=await input.propose(prompt, attempt, { currentScad, findings });
      proposed=reply.scad;
      modelExecution=reply.modelExecution;
    } catch (error) {
      await record({
        attempt, scadSha256: sha256(currentScad), findings: [], evidence: evidenceOf(measurement.manifest),
        accepted: false, violations: [], phase: "proposal-error", modelExecution,
        reason: "The repair call failed: " + (error instanceof Error ? error.message : String(error)),
        frozenRequirementsSha256,
      });
      return finish(input.signal?.aborted ? "aborted" : "repair-failed", attempts.at(-1)!.reason!);
    }
    if (expired()) {
      await record({attempt, scadSha256: sha256(proposed), findings: [], evidence: evidenceOf(measurement.manifest),
        accepted:false, violations:[], phase:"aborted", reason:stopped(), frozenRequirementsSha256, modelExecution,
        ...returnedSource(proposed)});
      return finish("aborted", stopped());
    }
    if (!proposed.trim() || Buffer.byteLength(proposed,"utf8") > MAX_SOURCE_BYTES) {
      const reason = proposed.trim() ? "The repaired source exceeded 256 KiB and was rejected before rendering." :
        "The repair returned empty source, so the previous candidate was kept.";
      await record({attempt,scadSha256:sha256(proposed),findings:[],evidence:evidenceOf(measurement.manifest),
        accepted:false,violations:[],phase:"proposal-error",reason,frozenRequirementsSha256,modelExecution,
        ...returnedSource(proposed)});
      return finish("repair-failed", reason);
    }
    if (proposed.trim() === currentScad.trim()) {
      const reason="The repair returned the source it was given, so re-measuring would repeat the same result.";
      await record({
        attempt,scadSha256:sha256(proposed),...returnedSource(proposed),
        findings:[],evidence:evidenceOf(measurement.manifest),
        accepted:false,violations:[],phase:"no-progress",reason,
        modelExecution,frozenRequirementsSha256,
      });
      return finish("no-progress", reason);
    }

    // A candidate that rewrites its embedded requirements is rejected BEFORE
    // any OpenSCAD render; it cannot buy a PASS by altering its own spec.
    if (input.strictEmbeddedSpec) {
      const embedded = extractEmbeddedAssemblySpec(proposed);
      const candidateHash = embedded.status === "valid" ? assemblySpecificationHash(embedded.spec) : null;
      if (candidateHash !== originalSpecHash) {
        const reason = "The candidate omitted or altered the frozen embedded specification; no geometry was rendered.";
        await record({attempt,scadSha256:sha256(proposed),findings:[],evidence:evidenceOf(measurement.manifest),
          accepted:false,violations:[{code:"invalid",message:reason}],
          phase:"rejected-before-render",reason,frozenRequirementsSha256,modelExecution,
          ...returnedSource(proposed)});
        return finish("invariant-violated", reason);
      }
    }
    let next: AssemblyMeasurement;
    try {
      next = await input.measure(proposed);
    } catch (error) {
      const reason = "The repaired source could not be measured: " + (error instanceof Error ? error.message : String(error));
      await record({attempt,scadSha256:sha256(proposed),findings:[],evidence:evidenceOf(measurement.manifest),
        accepted:false,violations:[],phase:"measurement-error",reason,frozenRequirementsSha256,modelExecution,
        ...returnedSource(proposed)});
      return finish(input.signal?.aborted ? "aborted" : "repair-failed", reason);
    }
    if (expired()) {
      await record({attempt,scadSha256:sha256(proposed),findings:[],evidence:evidenceOf(next.manifest),
        accepted:false,violations:[],phase:"aborted",reason:stopped(),frozenRequirementsSha256,modelExecution,
        ...returnedSource(proposed)});
      return finish("aborted", stopped());
    }
    const violations = assertRepairPreservesAssembly({ before: measurement.spec, after: next.spec, contract: input.contract });
    if (frozenFitHash(next.fitRequirements) !== frozenRequirementsSha256) {
      violations.violations.push({ code:"requirement-relaxed",
        message:"The proposed geometry changed the frozen fit measurement requirements."});
      violations.ok=false;
    }
    if (input.strictEmbeddedSpec && assemblySpecificationHash(next.spec as never) !== originalSpecHash) {
      violations.violations.push({code:"invalid",message:"Measured candidate spec differs from original frozen assembly."});
      violations.ok=false;
    }
    if (!violations.ok) {
      await record({
        attempt, scadSha256: sha256(proposed), findings: [],
        evidence: evidenceOf(next.manifest), violations: violations.violations, accepted: false,
        phase:"rejected-before-render",reason:"Repaired candidate violated frozen invariants",modelExecution,
        ...returnedSource(proposed),
        measurementProvenance:provenanceOf(next),
        measuredAt:new Date().toISOString(),frozenRequirementsSha256,
      });
      return finish("invariant-violated", `The repair weakened the assembly instead of fixing it: ${violations.violations.map((violation) => violation.message).join(" ")}`);
    }

    const nextFindings = collectAssemblyFindings({
      manifest: next.manifest, fitRequirements: next.fitRequirements, kinematics: next.kinematics,
    });
    await record({
      attempt, scadSha256: sha256(proposed), findings: nextFindings,
      evidence: evidenceOf(next.manifest), violations: [], accepted: true,
      phase:"measured",measuredAt:new Date().toISOString(),frozenRequirementsSha256,modelExecution,
      ...returnedSource(proposed),
      measurementProvenance:provenanceOf(next),
    });
    measurement = next;
    findings = nextFindings;
    currentScad = proposed;

    if (findings.length === 0) {
      return evidenceComplete(measurement.manifest)
        ? finish("no-findings", `Attempt ${attempt} closed every measured failure.`)
        : finish("incomplete-evidence", "Measured FAIL findings were closed, but required check coverage is still incomplete.");
    }
  }

  return finish("attempt-budget", `Still ${findings.length} measured failure(s) after ${maxAttempts} repair attempt(s).`);
}
