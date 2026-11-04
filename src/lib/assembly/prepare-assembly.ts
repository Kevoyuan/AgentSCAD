import { checkDeclaredPoseDisassembly } from "./declared-pose-disassembly";
import { createHash } from "crypto";
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { checkPartIdentity } from "./part-identity-check";
import { assessFit, measureRevoluteFit, type FitRequirement } from "./fit-measurement";
import { checkKinematics } from "./path-and-motion";
import { renderAssemblySpecParts, type RenderedAssemblyPart } from "../tools/assembly-part-renderer";
import type { ScadExecutionOptions } from "../tools/scad-renderer";
import { RequirementContractSchema, requirementContractHash } from "../requirements/requirement-contract";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
type Rendered = { parts: RenderedAssemblyPart[]; purchasedPartIds: string[] };
type Renderer = (source: string, spec: AssemblySpec, options?: ScadExecutionOptions) => Promise<Rendered>;

/** A fit requirement plus the one fact the mesh cannot supply: which side is the bore. */
export interface AssemblyFitRequirement extends FitRequirement {
  boreInstanceId: string;
  stationsMm?: number[];
}

type EvidenceStatus = "PASS" | "FAIL" | "NOT_RUN" | "ERROR";

function combine(statuses: EvidenceStatus[], reasons: string[], empty: string): { status: EvidenceStatus; reason: string } {
  if (statuses.length === 0) return { status: "NOT_RUN", reason: empty };
  const status: EvidenceStatus = statuses.includes("ERROR") ? "ERROR"
    : statuses.includes("FAIL") ? "FAIL"
    : statuses.includes("NOT_RUN") ? "NOT_RUN" : "PASS";
  return { status, reason: reasons.join(" ") };
}

/**
 * A PASS is only worth something against a contract a human actually approved.
 * When the contract is unconfirmed or stale, every PASS in the manifest is
 * downgraded to NOT_RUN with the reason attached.
 *
 * The downgrade is one-way: FAIL and ERROR are never softened, because hiding a
 * measured failure is worse than over-reporting one, and NOT_RUN is never
 * promoted. The raw measurement stays on the record — only its standing as a
 * verdict changes.
 */
function applyContractGate(status: EvidenceStatus, reason: string, gateReason: string | null): { status: EvidenceStatus; reason: string } {
  if (gateReason === null || status !== "PASS") return { status, reason };
  return { status: "NOT_RUN", reason: `${gateReason} The measurement itself passed: ${reason}` };
}

/**
 * Prepare an in-memory candidate. This publishes nothing and proves neither
 * part identity nor fit, motion, manufacturability or physical function.
 * Instance transforms are declared local-to-assembly poses, not measurements.
 */
export async function prepareAssembly(input: {
  scadSource: string;
  spec: unknown;
  /** Optional complete-assembly mesh at the same pose; without it, containment stays NOT_RUN. */
  assemblyMesh?: { stl: Buffer; sha256?: string } | null;
  /**
   * Optional frozen fit requirements. Without them the assembly evidence stays
   * NOT_RUN: a declaration is not a measurement.
   */
  fitRequirements?: AssemblyFitRequirement[];
  /**
   * Optional disassembly-path and motion sampling. Without it both layers stay
   * NOT_RUN: a declared range is not a measurement of motion.
   */
  kinematics?: {
    connectionId: string;
    movingInstanceIds?: string[];
    pathSteps?: number;
    motionSteps?: number;
  };
  /**
   * Confirmation state of the requirement contract these results are judged
   * against. Omitted means the question was not asked: the manifest then records
   * `contract.evidenceCurrent: null` rather than implying approval. Supplying
   * `evidenceCurrent: false` downgrades every PASS to NOT_RUN.
   */
  contractGate?: { evidenceCurrent: boolean; reason?: string | null };
  /** Exact contract and request used by the caller; binding does not attest user confirmation. */
  contractSnapshot?: { contract: unknown; request: string };
  options?: ScadExecutionOptions;
  render?: Renderer;
}) {
  if (!input.scadSource.trim()) throw new Error("Assembly source is empty");
  const checked = validateAssemblySpec(input.spec);
  if (!checked.success) throw new Error(`Invalid assembly specification: ${checked.error.message}`);
  const spec = checked.data;
  // Capture before awaiting the renderer: caller mutation cannot change provenance mid-run.
  const contract = input.contractSnapshot
    ? RequirementContractSchema.parse(input.contractSnapshot.contract) : null;
  const contractBinding = contract ? {
    sha256: requirementContractHash(contract),
    revision: contract.revision,
    requestSha256: contract.requestSha256,
    requestMatches: contract.requestSha256 === sha256(input.contractSnapshot!.request.trim()),
  } : null;
  input.options?.signal?.throwIfAborted();
  const result = await (input.render ?? renderAssemblySpecParts)(input.scadSource, spec, input.options);
  input.options?.signal?.throwIfAborted();

  const generated = new Set(spec.parts.filter((p) => p.source === "generated").map((p) => p.id));
  const purchased = new Set(spec.parts.filter((p) => p.source === "purchased").map((p) => p.id));
  const renderedIds = new Set<string>();
  for (const part of result.parts) {
    if (!generated.has(part.partId) || renderedIds.has(part.partId)) throw new Error("Rendered parts do not match the assembly specification");
    if (!Buffer.isBuffer(part.stl) || part.stl.length === 0 || sha256(part.stl) !== part.sha256) throw new Error(`Artifact hash mismatch for ${part.partId}`);
    renderedIds.add(part.partId);
  }
  if (renderedIds.size !== generated.size) throw new Error("Missing generated part artifact");
  const actualPurchased = new Set(result.purchasedPartIds);
  if (actualPurchased.size !== result.purchasedPartIds.length || actualPurchased.size !== purchased.size || [...actualPurchased].some((id) => !purchased.has(id))) {
    throw new Error("Purchased parts do not match the assembly specification");
  }
  // Hash the validated snapshot with the same canonical form used by the API.
  const sourceSha256 = sha256(input.scadSource);
  const specificationSha256 = assemblySpecificationHash(spec);
  const identity = checkPartIdentity({
    parts: result.parts.map((part) => ({ ...part, selector: spec.parts.find((item) => item.id === part.partId)!.selector })),
    assemblyMesh: input.assemblyMesh ?? null,
  });
  const meshes = Object.fromEntries(result.parts.map((part) => [part.partId, part.stl]));
  const gateReason = contractBinding?.requestMatches === false
    ? "The requirement contract belongs to a different request; its evidence is stale."
    : input.contractGate
    ? (input.contractGate.evidenceCurrent ? null : input.contractGate.reason?.trim() || "The requirement contract has not been confirmed against the current request, so its results cannot count.")
    : null;
  const fits = (input.fitRequirements ?? []).map((requirement) => {
    const measurement = measureRevoluteFit({
      spec, connectionId: requirement.connectionId, meshes,
      boreInstanceId: requirement.boreInstanceId, stationsMm: requirement.stationsMm,
    });
    const assessment = assessFit(measurement, requirement);
    const gated = applyContractGate(assessment.status, assessment.reason, gateReason);
    return {
      connectionId: requirement.connectionId,
      status: gated.status,
      reason: gated.reason,
      measuredStatus: assessment.status,
      stationsMm: measurement.stationsMm,
      diametralClearanceMm: measurement.clearanceMm,
      boreDiameterMm: measurement.bore?.measurement.diameterMm ?? null,
      shaftDiameterMm: measurement.shaft?.measurement.diameterMm ?? null,
      axisOffsetMm: measurement.axis?.offsetMm ?? null,
      axisAngleDeg: measurement.axis?.angleDeg ?? null,
      seedOffsetMm: measurement.bore?.seedOffsetMm ?? null,
      unknowns: measurement.unknowns,
    };
  });
  // Kinematics runs after the gate is known so its own verdicts are downgraded
  // the same way as every other layer.
  const kinematics = input.kinematics
    ? checkKinematics({
        spec,
        meshes,
        connectionId: input.kinematics.connectionId,
        movingInstanceIds: input.kinematics.movingInstanceIds,
        pathSteps: input.kinematics.pathSteps,
        motionSteps: input.kinematics.motionSteps,
      })
    : null;
  const declaredDisassembly = checkDeclaredPoseDisassembly({ spec, meshes });
  const declaredPathEvidence = applyContractGate(declaredDisassembly.status, declaredDisassembly.reason, gateReason);
  /**
   * The detailed record follows the same rule as `fits`: `status` is the
   * contract-gated verdict, `measuredStatus` is what the geometry actually said.
   * Keeping an ungated PASS under a verdict-shaped field would let a caller that
   * reads this record instead of `evidence.disassembly` claim approval that
   * never happened.
   */
  const declaredDisassemblyRecord = {
    ...declaredDisassembly,
    status: declaredPathEvidence.status,
    reason: declaredPathEvidence.reason,
    measuredStatus: declaredDisassembly.status,
    measuredReason: declaredDisassembly.reason,
  };
  const pathEvidence = kinematics
    ? applyContractGate(kinematics.path.status as EvidenceStatus, kinematics.path.reason, gateReason)
    : { status: "NOT_RUN" as EvidenceStatus, reason: "Disassembly was not checked." };
  const motionEvidence = kinematics
    ? applyContractGate(kinematics.motion.status as EvidenceStatus, kinematics.motion.reason, gateReason)
    : { status: "NOT_RUN" as EvidenceStatus, reason: "Motion was not checked." };
  const assemblyEvidence = combine(
    [...fits.map((fit) => fit.status as EvidenceStatus), ...(kinematics ? [pathEvidence.status] : [])],
    [...fits.map((fit) => `${fit.connectionId}: ${fit.reason}`), ...(kinematics ? [`path: ${pathEvidence.reason}`] : [])],
    "Declared poses and connections were not checked against geometry.",
  );
  const identityEvidence = applyContractGate(identity.status as EvidenceStatus, identity.reason, gateReason);
  const manifest = {
    schemaVersion: 1 as const,
    sourceSha256,
    specificationSha256,
    units: spec.units,
    coordinateSystem: spec.coordinateSystem,
    parts: spec.parts.map((part) => ({
      id: part.id, name: part.name, source: part.source, selector: part.selector,
      quantity: spec.instances.filter(instance => instance.partId === part.id).length,
      artifactSha256: result.parts.find((item) => item.partId === part.id)?.sha256 ?? null,
    })),
    instances: spec.instances.map((instance) => ({ ...instance })),
    subassemblies: spec.subassemblies.map((subassembly) => ({ ...subassembly })),
    fits,
    kinematics,
    declaredDisassembly: declaredDisassemblyRecord,
    /**
     * `evidenceCurrent: null` means no contract was supplied, so the question
     * "is this the user's actual requirement" was never asked. It is not a
     * claim of approval.
     */
    contract: {
      binding: contractBinding,
      evidenceCurrent: gateReason ? false : input.contractGate ? true : null,
      reason: gateReason ?? (input.contractGate
        ? gateReason ?? "The results were judged against a confirmed requirement contract."
        : "Confirmation was not evaluated; a bound contract does not imply user approval."),
    },
    evidence: {
      identity: identityEvidence,
      geometry: { status: "NOT_RUN" as const, reason: "Topology and dimensions were not independently checked." },
      assembly: assemblyEvidence,
      disassembly: declaredPathEvidence,
      motion: motionEvidence,
      physical: { status: "NOT_RUN" as const, reason: "Physical manufacture and function were not tested." },
    },
  };
  return { spec, manifest, parts: result.parts, purchasedPartIds: result.purchasedPartIds, identity, fits, kinematics };
}
