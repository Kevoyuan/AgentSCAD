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
 * - The contract is **derived** from the request and used without confirmation.
 *   A trial has no user in it. Passing here means "met the machine reading of
 *   the request", and callers must not report it as user acceptance.
 * - No `contractGate` is passed, so `contract.evidenceCurrent` stays `null`
 *   ("not asked") instead of `false` ("no"). Passing `false` would turn every
 *   measurement into NOT_RUN and make the trial unable to distinguish a bad
 *   model from an unconfirmed contract.
 */
import { deriveRequirementContract } from "../../src/lib/requirements/extract-requirements";
import { requirementContractHash } from "../../src/lib/requirements/requirement-contract";
import { toEvidenceRequirements, toFitRequirements } from "../../src/lib/requirements/contract-bridge";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { prepareAssembly } from "../../src/lib/assembly/prepare-assembly";
import { collectAssemblyFindings } from "../../src/lib/assembly/repair-findings";
import { validateAssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { createHash } from "node:crypto";
import { evaluateAssembly, type Observation } from "./assembly-evidence";

export interface Judgement {
  passed: boolean;
  contractSha256: string;
  evidence: Array<{ id: string; status: string }>;
  /** One line per measured failure, ready to be fed back as repair input. */
  findings: string[];
  /** Why the candidate failed before any measurement could happen, if it did. */
  blockedBy: string | null;
}

/** Which declared connection type the request is asking for. */
const CONNECTION_FOR_INTENT: Record<string, string> = {
  "revolute-hinge": "revolute",
  "bolted-joint": "fixed",
  "sliding-joint": "prismatic",
};

export async function judgeAssemblyCandidate(input: {
  prompt: string;
  scad: string;
  pathSteps?: number;
  motionSteps?: number;
}): Promise<Judgement> {
  const contract = deriveRequirementContract({ request: input.prompt });
  const contractSha256 = requirementContractHash(contract);
  const blocked = (blockedBy: string): Judgement => ({
    passed: false, contractSha256, evidence: [], findings: [blockedBy], blockedBy,
  });

  const extracted = extractEmbeddedAssemblySpec(input.scad);
  if (extracted.status !== "valid") {
    return blocked("The source carries no valid embedded assembly declaration, so there is nothing to measure.");
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

  const whole = await renderAssemblyParts({ scadSource: input.scad, parts: [{ partId: "assembly", selector: "all" }] });
  const prepared = await prepareAssembly({
    contractSnapshot: { contract, request: input.prompt },
    scadSource: input.scad,
    spec,
    assemblyMesh: { stl: whole[0].stl, sha256: whole[0].sha256 },
    fitRequirements: fits,
    kinematics: { connectionId: declared.id, pathSteps: input.pathSteps, motionSteps: input.motionSteps },
  });

  const artifactSha256 = createHash("sha256")
    .update(Buffer.concat(prepared.parts.map((part) => part.stl)))
    .digest("hex");
  const provenance = { artifactSha256, toolVersion: "agentscad.trial/1" };
  const clearance = prepared.fits[0]?.diametralClearanceMm ?? null;
  const path = prepared.kinematics?.path ?? null;
  const motion = prepared.kinematics?.motion ?? null;

  const observations: Record<string, Observation> = {
    "intent-preserved": {
      id: "intent-preserved", status: "MEASURED", value: true, ...provenance,
      method: `Looked for a ${wanted} connection in the declaration, as the derived intent requires.`,
      coverage: "Declaration only; no geometry is involved.",
    },
    "distinct-exported-parts": {
      id: "distinct-exported-parts", status: "MEASURED",
      value: new Set(prepared.parts.map((part) => part.sha256)).size, ...provenance,
      method: "Counted distinct part artifact hashes from the selector render.",
      coverage: "One selector per declared part; part identity is not established.",
    },
    "disassembly-path": {
      id: "disassembly-path", status: path ? "MEASURED" : "NOT_RUN",
      value: path?.status === "PASS", ...provenance,
      method: "BVH triangle collision over sampled offsets along the joint axis.",
      coverage: path?.coverage ?? "Not sampled.",
    },
    "sampled-motion": {
      id: "sampled-motion", status: motion ? "MEASURED" : "NOT_RUN",
      value: motion?.status === "PASS", ...provenance,
      method: "BVH triangle collision over sampled rotation angles.",
      coverage: motion?.coverage ?? "Not sampled.",
    },
    "motion-range-deg": {
      id: "motion-range-deg", status: motion?.rangeDeg ? "MEASURED" : "NOT_RUN",
      value: motion?.rangeDeg ? Math.max(Math.abs(motion.rangeDeg.min), Math.abs(motion.rangeDeg.max)) : 0,
      uncertainty: 0, unit: "deg", ...provenance,
      method: "Largest sampled angle that was free of interference.",
      coverage: motion?.coverage ?? "Not sampled.",
    },
    "diametral-clearance": {
      id: "diametral-clearance", status: clearance ? "MEASURED" : "NOT_RUN",
      value: clearance ? (clearance.min + clearance.max) / 2 : 0,
      uncertainty: clearance ? (clearance.max - clearance.min) / 2 : 0,
      unit: "mm", ...provenance,
      method: "Planar section at the sampled axial stations, radial ray casting, regular-polygon fit.",
      coverage: prepared.fits[0] ? `Stations: ${prepared.fits[0].stationsMm.map((value) => value.toFixed(2)).join(", ")} mm.` : "Not measured.",
    },
  };

  const requirements = toEvidenceRequirements(contract);
  const known = new Set(requirements.map((requirement) => requirement.id));
  const report = evaluateAssembly(requirements, Object.values(observations).filter((observation) => known.has(observation.id)));

  const findings = collectAssemblyFindings({
    manifest: prepared.manifest,
    fitRequirements: fits,
    kinematics: prepared.kinematics,
  }).map((finding) => finding.message);

  return {
    passed: report.gate_passed,
    contractSha256,
    evidence: report.evidence.map((item) => ({ id: item.id, status: item.status })),
    findings,
    blockedBy: null,
  };
}
