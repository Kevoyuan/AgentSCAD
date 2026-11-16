#!/usr/bin/env bun
/**
 * Turns one (request, SCAD source) pair into a per-assertion verdict.
 *
 * This is the judging half of the generation trial. It is deliberately separate
 * from the trial runner so the same judgement can be applied to a recorded
 * source, a model reply or a hand-written fixture, and so the trial's budget
 * accounting never has to know how a candidate is measured.
 *
 * Two decisions are visible here:
 *
 * - The contract is **derived** from the request. A trial has no user in it.
 *   The derived contract is passed to the preparation as a trial attribution
 *   gate: it lets source-driven motion and the axial-retention assertion run,
 *   but the manifest records `TRIAL_GATE_REASON` and the judgement carries
 *   `trialAttribution`. That is measurement attribution, not user confirmation,
 *   acceptance, or a product requirement contract.
 * - The `intent-preserved` assertion has no independent coverage audit, so it
 *   stays NOT_RUN and `passed` never means the complete request was preserved
 *   or accepted. Reports must read the per-assertion evidence.
 * - The seeded challenge pose is derived deterministically from prompt and
 *   source unless `sourceSamplingSeed` is supplied, so re-judging the same
 *   candidate is reproducible.
 */
import { deriveRequirementContract } from "../../src/lib/requirements/extract-requirements";
import { requirementContractHash, unknownsInScope, type RequirementContract } from "../../src/lib/requirements/requirement-contract";
import { toEvidenceRequirements, toFitRequirements } from "../../src/lib/requirements/contract-bridge";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { prepareAssembly } from "../../src/lib/assembly/prepare-assembly";
import { automaticHingeKinematics } from "../../src/lib/assembly/automatic-hinge-kinematics";
import { collectAssemblyFindings } from "../../src/lib/assembly/repair-findings";
import { validateAssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { createHash } from "node:crypto";
import { evaluateAssembly, type Observation } from "./assembly-evidence";
import {isRepairableScadCompileError,annotateScadCompileError} from "../../src/lib/tools/scad-compile-error";
import {diagnoseAssemblySource,summarizeAssemblySourceDiagnostics,type AssemblySourceDiagnostics} from "../../src/lib/assembly/source-diagnostics";
import {assessAssemblyRequirements, hasAssemblyRequirementAssertion} from "../../src/lib/validation/assembly-requirement-assertions";

/** A declared range is observable coverage only after every sampled pose clears. */
export function motionRangeObservations(motion: {status:string;rangeDeg?:{min:number;max:number}|null;coverage:string}|null, provenance: {artifactSha256:string;toolVersion:string}): Observation[] {
  const range=motion?.status==="PASS"?motion.rangeDeg:undefined;
  const common={status:range?"MEASURED" as const:"NOT_RUN" as const,uncertainty:0,unit:"deg",...provenance,
    method:"Bounds of the ideal rigid-pose interval whose sampled collision checks all passed.",coverage:motion?.coverage??"Not sampled.",
    reason:range?undefined:"The entire sampled motion interval did not pass; declaration bounds alone cannot establish coverage."};
  return [
    {id:"motion-range-deg",value:range?Math.max(Math.abs(range.min),Math.abs(range.max)):0,...common},
    {id:"motion-range-negative-end",value:range?-range.min:0,...common},
    {id:"motion-range-positive-end",value:range?range.max:0,...common},
  ];
}

const observationStatus=(status?:string): Observation["status"]=>status==="PASS"||status==="FAIL"?"MEASURED":status==="ERROR"?"ERROR":"NOT_RUN";

/** A joint-axis probe is not an inventory-complete declared operation sequence. */
export function declaredPathObservation(id: "assembly-path" | "disassembly-path", evidence: { status: string; reason: string } | undefined,
  coverage: string | undefined, provenance: { artifactSha256: string; toolVersion: string }): Observation {
  return {
    id, status: observationStatus(evidence?.status), value: evidence?.status === "PASS", ...provenance,
    method: id === "assembly-path" ? "Collision sampling of the declared rigid insertion sequence via its exact geometric reverse."
      : "Collision sampling of every declared removal in its stated order with the remaining instance inventory.",
    coverage: coverage ?? "No declared sequence was checked.", reason: evidence?.reason,
  };
}

export interface Judgement {
  diagnostics?:AssemblySourceDiagnostics;
  passed: boolean;
  contractSha256: string;
  /** The contract was derived from the request; the gate records measurement
   * attribution, not user confirmation. */
  trialAttribution?: string;
  evidence: Array<{ id: string; status: string }>;
  /** One line per measured failure, ready to be fed back as repair input. */
  findings: string[];
  /** Why the candidate failed before any measurement could happen, if it did. */
  blockedBy: string | null;
}

/** Missing requirements do not invalidate individual measurements, but cannot yield a trial pass. */
export function unresolvedContractEvidence(contract: RequirementContract) {
  return unknownsInScope(contract).map((unknown) => ({ id: `unresolved-${unknown.id}`, status: "NOT_RUN" as const, question: unknown.question }));
}

/** Optional experiments are mandatory once declared; unavailable results cannot disappear. */
export function declaredTranslationProbeEvidence(spec: {translationProbes?: unknown[]}, measured?: {status:string}) {
  return spec.translationProbes?.length
    ? [{id:"declared-translation-probes",status:measured?.status ?? "NOT_RUN"}]
    : [];
}

/** Which declared connection type the request is asking for. */
const CONNECTION_FOR_INTENT: Record<string, string> = {
  "revolute-hinge": "revolute",
  "bolted-joint": "fixed",
  "sliding-joint": "prismatic",
};

export const TRIAL_GATE_REASON = "Trial evaluator: the derived contract is used for measurement attribution only; this is not user confirmation, acceptance, or a product requirement contract.";

/** Maps an assertion to the comparator's observation vocabulary without
 * upgrading a non-pass into measured evidence. */
function assertionObservation(id: string, assertion: { status: string; reason: string } | undefined,
  provenance: { artifactSha256: string; toolVersion: string }): Observation | null {
  if (!assertion) return null;
  if (assertion.status === "PASS" || assertion.status === "FAIL") return {
    id, status: "MEASURED", value: assertion.status === "PASS",
    artifactSha256: provenance.artifactSha256, toolVersion: provenance.toolVersion,
    method: "Declared rigid axial translation probes at declared working and disassembly poses.",
    coverage: assertion.reason, reason: assertion.reason,
  };
  return { id, status: assertion.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: assertion.reason };
}

export async function judgeAssemblyCandidate(input: {
  prompt: string;
  scad: string;
  pathSteps?: number;
  motionSteps?: number;
  /** Replays one frozen sampling challenge across the same candidate. */
  sourceSamplingSeed?: string;
  /** Optional raw-artifact capture for reproducible trials. */
  onPrepared?: (prepared: Awaited<ReturnType<typeof prepareAssembly>>, whole: Awaited<ReturnType<typeof renderAssemblyParts>>[number]) => Promise<void>;
  onDiagnostics?: (result:Awaited<ReturnType<typeof diagnoseAssemblySource>>)=>Promise<void>;
}): Promise<Judgement> {
  const contract = deriveRequirementContract({ request: input.prompt });
  const contractSha256 = requirementContractHash(contract);
  const blocked = (blockedBy: string): Judgement => ({
    passed: false, contractSha256, evidence: [], findings: [blockedBy], blockedBy,
  });

  const extracted = extractEmbeddedAssemblySpec(input.scad);
  if (extracted.status !== "valid") {
    const result=blocked(`The source carries no valid embedded assembly declaration, so full assembly verification is unavailable.${extracted.status === "invalid" ? ` ${extracted.reason}` : ""}`);
    if(extracted.status==="invalid") {
      const diagnostic=await diagnoseAssemblySource({scadSource:input.scad});
      await input.onDiagnostics?.(diagnostic);
      result.diagnostics=diagnostic.report;
      result.findings.push(summarizeAssemblySourceDiagnostics(diagnostic.report));
    }
    return result;
  }
  const spec = extracted.spec;
  const parsed = validateAssemblySpec(spec);
  if (!parsed.success) return blocked("The embedded assembly declaration is invalid.");

  const wanted = CONNECTION_FOR_INTENT[contract.intent.kind];
  const declared = parsed.data.connections.find((connection) => connection.type === wanted);
  if (!declared) {
    return blocked(`The request asks for a ${contract.intent.kind}, but the declaration has no ${wanted} connection.`);
  }

  let fits;
  try {
    fits = toFitRequirements(contract, spec, { connectionId: declared.id });
  } catch (error) {
    // A missing bore side is a property of the candidate, not a harness fault.
    return blocked(error instanceof Error ? error.message : String(error));
  }

  const autoMotion = automaticHingeKinematics(spec);
  let whole:Awaited<ReturnType<typeof renderAssemblyParts>>;
  let prepared:Awaited<ReturnType<typeof prepareAssembly>>;
  try {
    whole = await renderAssemblyParts({ scadSource: input.scad, parts: [{ partId: "assembly", selector: "all" }] });
    prepared = await prepareAssembly({
    contractSnapshot: { contract, request: input.prompt },
    scadSource: input.scad,
    spec,
    assemblyMesh: { stl: whole[0].stl, sha256: whole[0].sha256 },
    fitRequirements: fits,
    kinematics: autoMotion ? { ...autoMotion, pathSteps: input.pathSteps, motionSteps: input.motionSteps } : undefined,
    contractGate: { evidenceCurrent: true, reason: TRIAL_GATE_REASON },
    sourceSamplingSeed: input.sourceSamplingSeed
      ?? createHash("sha256").update(input.prompt).update("\0").update(input.scad).digest("hex").slice(0, 32),
    });
  } catch(error) {
    if(!isRepairableScadCompileError(error))throw error;
    const annotated=annotateScadCompileError(error,input.scad);
    const reason=annotated instanceof Error?annotated.message:String(annotated);
    return {...blocked(`Candidate source execution rejected: ${reason}. Subsequent requirement checks were not executed.`),
      evidence:[{id:"compile",status:"FAIL"},...toEvidenceRequirements(contract).filter(requirement=>requirement.required&&requirement.applicable).map(requirement=>({id:requirement.id,status:"NOT_RUN"}))]};
  }
  await input.onPrepared?.(prepared, whole[0]);

  const artifactSha256 = createHash("sha256")
    .update(Buffer.concat(prepared.parts.map((part) => part.stl)))
    .digest("hex");
  const provenance = { artifactSha256, toolVersion: "agentscad.trial/1" };
  const clearance = prepared.fits[0]?.diametralClearanceMm ?? null;
  const motion = prepared.kinematics?.motion ?? null;
  const motionStatus=prepared.manifest.evidence.motion.status;

  const observations: Record<string, Observation> = {
    "intent-preserved": {
      id: "intent-preserved", status: "NOT_RUN", ...provenance,
      method: `Found a declared ${wanted} connection.`,
      coverage: "Connection type only. Remaining request clauses and their geometric implementation were not independently audited.",
      reason: "A matching declared connection does not establish preservation of the complete request. An independent requirement-coverage audit is unavailable.",
    },
    "distinct-exported-parts": {
      id: "distinct-exported-parts", status: "MEASURED",
      value: new Set(prepared.parts.map((part) => part.sha256)).size, ...provenance,
      method: "Counted distinct part artifact hashes from the selector render.",
      coverage: "One selector per declared part; part identity is not established.",
    },
    "disassembly-path": declaredPathObservation("disassembly-path", prepared.manifest.evidence.disassembly,
      prepared.manifest.declaredDisassembly.coverage, provenance),
    "assembly-path": declaredPathObservation("assembly-path", prepared.manifest.evidence.assemblyPath,
      prepared.manifest.declaredAssembly.coverage, provenance),
    "sampled-motion": {
      id: "sampled-motion", status: observationStatus(motionStatus),
      value: motionStatus === "PASS", ...provenance,
      method: "BVH triangle collision over sampled rotation angles.",
      coverage: motion?.coverage ?? "Not sampled.",
    },
    "diametral-clearance": {
      id: "diametral-clearance", status: clearance ? "MEASURED" : prepared.fits[0]?.measuredStatus === "ERROR" ? "ERROR" : "NOT_RUN",
      value: clearance ? (clearance.min + clearance.max) / 2 : 0,
      uncertainty: clearance ? (clearance.max - clearance.min) / 2 : 0,
      unit: "mm", ...provenance,
      method: "Planar section at the sampled axial stations, radial ray casting, regular-polygon fit.",
      coverage: prepared.fits[0] ? `Stations: ${prepared.fits[0].stationsMm.map((value) => value.toFixed(2)).join(", ")} mm.` : "Not measured.",
    },
  };
  for(const observation of motionRangeObservations(motion?{...motion,status:motionStatus}:null,provenance)) observations[observation.id]=observation;
  const retention = contract.requirements.some(requirement => requirement.id === "axial-retention" && requirement.required && requirement.applicable)
    ? assessAssemblyRequirements(contract, spec, prepared).find(item => item.id === "axial-retention") : undefined;
  const retentionObservation = retention ? assertionObservation("axial-retention", retention, provenance) : null;
  if (retentionObservation) observations["axial-retention"] = retentionObservation;

  const requirements = toEvidenceRequirements(contract);
  const known = new Set(requirements.map((requirement) => requirement.id));
  const report = evaluateAssembly(requirements, Object.values(observations).filter((observation) => known.has(observation.id)));
  const unresolved = unresolvedContractEvidence(contract);
  const probeEvidence = declaredTranslationProbeEvidence(spec, prepared.manifest.translationProbes);

  const findings = collectAssemblyFindings({
    manifest: prepared.manifest,
    fitRequirements: fits,
    kinematics: prepared.kinematics,
  }).map((finding) => finding.message);
  if (requirements.some(requirement => requirement.id === "intent-preserved" && requirement.required && requirement.applicable)) {
    findings.push(`Unresolved intent-preserved (NOT_RUN): ${observations["intent-preserved"].reason} Preserve all original request clauses when repairing measured defects.`);
  }
  findings.push(...unresolved.map((item) => `Unresolved requirement (${item.id}, NOT_RUN): ${item.question}`));
  findings.push(`Measurement attribution: ${TRIAL_GATE_REASON}`);
  if (probeEvidence.some(item=>item.status==="NOT_RUN"||item.status==="ERROR")) findings.push(`Unresolved declared translation experiments (${prepared.manifest.translationProbes.status}): ${prepared.manifest.translationProbes.reason}`);
  for(const part of prepared.manifest.partConnectivity) if(part.status==="NOT_RUN"||part.status==="ERROR") findings.push(`Unresolved connectivity for ${part.partId} (${part.status}): ${part.reason}. Do not infer disconnected solids from nested surfaces alone.`);
  if(prepared.reconstruction.status==="ERROR"||prepared.reconstruction.status==="NOT_RUN") {
    findings.push(`Unresolved assembly reconstruction (${prepared.reconstruction.status}): ${prepared.reconstruction.reason} This is not a measured placement mismatch; review the input meshes and complete instance coverage without weakening the required assembly.`);
  }
  for(const fit of prepared.fits) {
    if(fit.measuredStatus==="ERROR"||fit.measuredStatus==="NOT_RUN") {
      findings.push(`Unresolved fit measurement for ${fit.connectionId} (${fit.measuredStatus}): ${fit.reason} This is not a measured geometry failure; preserve the requested fit while reviewing the feature declaration and checker coverage.`);
    }
    if(fit.jointFrames.measuredStatus==="ERROR"||fit.jointFrames.measuredStatus==="NOT_RUN") findings.push(`Unresolved mating-feature frame check for ${fit.connectionId} (${fit.jointFrames.measuredStatus}): ${fit.jointFrames.measuredReason}`);
  }
  for (const [id, layer] of [["assembly-path", "assemblyPath"], ["disassembly-path", "disassembly"]] as const) {
    const required = requirements.some(requirement => requirement.id === id && requirement.required && requirement.applicable);
    const evidence = prepared.manifest.evidence[layer];
    if (required && (evidence.status === "NOT_RUN" || evidence.status === "ERROR")) {
      findings.push(`Unresolved declared ${id} (${evidence.status}): ${evidence.reason} Supply a justified complete operation sequence for every non-grounded instance, preserving required parts and connections. This is missing or unavailable sequence evidence, not a measured collision and not permission to label the path as passed.`);
    }
  }

  return {
    passed: report.gate_passed && unresolved.length === 0 && probeEvidence.every(item=>item.status==="PASS") && prepared.manifest.partConnectivity.every(p=>p.status==="PASS") && prepared.manifest.evidence.identity.status === "PASS" && prepared.reconstruction.status === "PASS" && prepared.manifest.evidence.jointFrames.status === "PASS",
    contractSha256,
    evidence: [...report.evidence.map((item) => ({ id: item.id, status: item.status })),
      {id:"declared-connection-type",status:"PASS"},
      {id:"part-connectivity",status:prepared.manifest.partConnectivity.some(p=>p.status==="FAIL")?"FAIL":prepared.manifest.partConnectivity.some(p=>p.status==="ERROR")?"ERROR":prepared.manifest.partConnectivity.every(p=>p.status==="PASS")?"PASS":"NOT_RUN"},
      {id:"measured-part-identity",status:prepared.manifest.evidence.identity.status},
      {id:"assembly-reconstruction",status:prepared.reconstruction.status},
      {id:"measured-joint-frames",status:prepared.manifest.evidence.jointFrames.status},
      ...(requirements.some(requirement => requirement.id === "sampled-motion" && requirement.required && requirement.applicable)
        ? [{id:"rigid-motion",status:prepared.manifest.evidence.rigidMotion.status},
           {id:"source-motion",status:prepared.manifest.evidence.sourceMotion.status}] : []),
      ...probeEvidence,...unresolved.map(({id,status})=>({id,status}))],
    findings,
    trialAttribution: TRIAL_GATE_REASON,
    blockedBy: null,
  };
}
