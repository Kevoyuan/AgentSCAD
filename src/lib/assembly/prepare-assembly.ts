import {checkPartConnectivity} from "./part-connectivity";
import { checkDeclaredPoseDisassembly } from "./declared-pose-disassembly";
import { checkDeclaredPoseAssembly } from "./declared-pose-assembly";
import { createHash, randomBytes } from "crypto";
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { checkPartIdentity } from "./part-identity-check";
import { assessFit, measureRevoluteFit, type FitRequirement } from "./fit-measurement";
import { checkKinematics } from "./path-and-motion";
import { renderAssemblySpecParts, type RenderedAssemblyPart } from "../tools/assembly-part-renderer";
import type { ScadExecutionOptions } from "../tools/scad-renderer";
import { checkAssemblyReconstruction } from "../tools/assembly-reconstruction";
import { checkMeasuredJointFrames, JOINT_FRAME_CONSISTENCY_LIMITS } from "./measured-joint-frame";
import { RequirementContractSchema, requirementContractHash, unknownsInScope, withDerivedUnknowns } from "../requirements/requirement-contract";
import { deriveRequirementContract } from "../requirements/extract-requirements";
import { checkDeclaredTranslationProbes } from "./declared-translation-probes";
import { buildHingeSourceProtocol } from "./source-motion-protocol";
import { verifySourcePoses, type SourcePoseArtifact } from "../tools/source-pose-verification";

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
  /** Replay a saved sampling protocol. HTTP adapters generate a fresh seed. */
  sourceSamplingSeed?: string;
  onSourcePoseArtifact?: (artifact: SourcePoseArtifact) => void | Promise<void>;
  options?: ScadExecutionOptions;
  render?: Renderer;
}) {
  if (!input.scadSource.trim()) throw new Error("Assembly source is empty");
  const scadSource = input.scadSource;
  input = { ...input,
    contractGate: input.contractGate ? { ...input.contractGate } : undefined,
    contractSnapshot: input.contractSnapshot ? structuredClone(input.contractSnapshot) : undefined,
    fitRequirements: input.fitRequirements ? structuredClone(input.fitRequirements) : undefined,
    kinematics: input.kinematics ? structuredClone(input.kinematics) : undefined,
  };
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
  const result = await (input.render ?? renderAssemblySpecParts)(scadSource, spec, input.options);
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
  const sourceSha256 = sha256(scadSource);
  const specificationSha256 = assemblySpecificationHash(spec);
  if(input.assemblyMesh?.sha256 && sha256(input.assemblyMesh.stl)!==input.assemblyMesh.sha256) throw new Error("Assembly artifact hash mismatch");
  const partConnectivity = result.parts.map(part=>({partId:part.partId,sha256:part.sha256,...checkPartConnectivity(part.stl)}));
  const identity = checkPartIdentity({
    parts: result.parts.map((part) => ({ ...part, selector: spec.parts.find((item) => item.id === part.partId)!.selector })),
    assemblyMesh: input.assemblyMesh ?? null,
    instances: spec.instances,
  });
  const meshes = Object.fromEntries(result.parts.map((part) => [part.partId, part.stl]));
  const translationProbes = checkDeclaredTranslationProbes({ spec, meshes, signal: input.options?.signal });
  const gateReason = contractBinding?.requestMatches === false
    ? "The requirement contract belongs to a different request; its evidence is stale."
    : input.contractGate
    ? (input.contractGate.evidenceCurrent ? null : input.contractGate.reason?.trim() || "The requirement contract has not been confirmed against the current request, so its results cannot count.")
    : null;
  const reconstruction = await checkAssemblyReconstruction({ spec, meshes, assemblyMesh: input.assemblyMesh?.stl, options: input.options });
  const reconstructionEvidence = applyContractGate(reconstruction.status, reconstruction.reason, gateReason);
  const fits = (input.fitRequirements ?? []).map((requirement) => {
    const measurement = measureRevoluteFit({
      spec, connectionId: requirement.connectionId, meshes,
      boreInstanceId: requirement.boreInstanceId, stationsMm: requirement.stationsMm,
    });
    const assessment = assessFit(measurement, requirement);
    const gated = applyContractGate(assessment.status, assessment.reason, gateReason);
    const frameCheck=checkMeasuredJointFrames({spec,measurement,limits:JOINT_FRAME_CONSISTENCY_LIMITS});
    const frameVerdict=applyContractGate(frameCheck.status,frameCheck.reason,gateReason);
    return {
      connectionId: requirement.connectionId,
      status: gated.status,
      reason: gated.reason,
      measuredStatus: assessment.status,
      stationsMm: measurement.stationsMm,
      stationSource: measurement.stationSource ?? "not-selected",
      stationFrame: measurement.stationFrame ?? null,
      diametralClearanceMm: measurement.clearanceMm,
      boreDiameterMm: measurement.bore?.measurement.diameterMm ?? null,
      shaftDiameterMm: measurement.shaft?.measurement.diameterMm ?? null,
      axisOffsetMm: measurement.axis?.offsetMm ?? null,
      axisAngleDeg: measurement.axis?.angleDeg ?? null,
      seedOffsetMm: measurement.bore?.seedOffsetMm ?? null,
      unknowns: measurement.unknowns,
      jointFrames:{...frameCheck,...frameVerdict,measuredStatus:frameCheck.status,measuredReason:frameCheck.reason},
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
  const declaredAssembly = checkDeclaredPoseAssembly({ spec, meshes });
  const declaredAssemblyEvidence = applyContractGate(declaredAssembly.status, declaredAssembly.reason, gateReason);
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
  let motionEvidence = kinematics
    ? applyContractGate(kinematics.motion.status as EvidenceStatus, kinematics.motion.reason, gateReason)
    : { status: "NOT_RUN" as EvidenceStatus, reason: "Motion was not checked." };
  const motionFrames=fits.find(fit=>fit.connectionId===input.kinematics?.connectionId)?.jointFrames;
  if(kinematics?.motion.status==="PASS"&&motionEvidence.status==="PASS"&&motionFrames?.status!=="PASS") {
    motionEvidence={status:motionFrames?.status??"NOT_RUN",reason:`Rigid-pose collision samples passed, but the actual mating feature axes were not verified against the declared motion frame: ${motionFrames?.reason??"No measured mating feature axes."}`};
  }
  const rigidMotionEvidence = motionEvidence;
  const sourceProtocol = buildHingeSourceProtocol(spec, input.sourceSamplingSeed ?? randomBytes(16).toString("hex"));
  const canVerifySource = sourceProtocol.status === "READY" && input.contractGate?.evidenceCurrent === true
    && contractBinding?.requestMatches === true && gateReason === null
    && motionFrames?.status === "PASS" && input.kinematics?.connectionId === sourceProtocol.connectionId;
  const sourceMotion = canVerifySource && sourceProtocol.status === "READY"
    ? { ...await verifySourcePoses({ ...sourceProtocol.protocol, scadSource, spec, options: input.options,
      onArtifact: input.onSourcePoseArtifact }), sampling: sourceProtocol.sampling } : null;
  const sourceMotionEvidence = sourceMotion
    ? applyContractGate(sourceMotion.status as EvidenceStatus,
      `Source input verification ${sourceMotion.status}. ${sourceMotion.results.map(item =>
        `${item.id} ${item.status}: ${item.reason} ${(item.comparisons ?? []).filter(row => row.result.status !== "PASS" || row.observability?.status === "NOT_RUN").map(row => `${row.instanceId}: ${row.result.reason} ${row.observability?.reason ?? ""}`).join(" ")}`).join(" ")} ${sourceMotion.coverage}`, gateReason)
    : { status: "NOT_RUN" as const, reason: sourceProtocol.status === "NOT_RUN" ? sourceProtocol.reason
      : "Source motion requires a current confirmed contract and measured mating axes for this sampled joint." };
  motionEvidence = combine([rigidMotionEvidence.status, sourceMotionEvidence.status],
    [rigidMotionEvidence.reason, sourceMotionEvidence.reason], "Motion was not checked.");
  const uncheckedConnections=spec.connections.filter(connection=>!fits.some(fit=>fit.connectionId===connection.id));
  const jointFrameEvidence=combine([...fits.map(fit=>fit.jointFrames.status),...(uncheckedConnections.length?["NOT_RUN" as const]:[])],
    [...fits.map(fit=>`${fit.connectionId}: ${fit.jointFrames.reason}`),...(uncheckedConnections.length?[`No measured axes for: ${uncheckedConnections.map(connection=>connection.id).join(", ")}.`]:[])],"No actual joint feature axes were measured.");
  const assemblyEvidence = combine(
    [reconstructionEvidence.status,...fits.map((fit) => fit.status as EvidenceStatus),...(spec.connections.length?[jointFrameEvidence.status]:[]), ...(uncheckedConnections.length?["NOT_RUN" as const]:[]),...(spec.translationProbes?.length?[translationProbes.status]:[])],
    [`reconstruction: ${reconstructionEvidence.reason}`,...fits.map((fit) => `${fit.connectionId}: ${fit.reason}`),...(spec.connections.length?[`joint frames: ${jointFrameEvidence.reason}`]:[]),...(uncheckedConnections.length?[`Connection features were not measured: ${uncheckedConnections.map(connection=>connection.id).join(", ")}.`]:[]),...(spec.translationProbes?.length?[`translation probes: ${translationProbes.reason}`]:[])],
    "Declared poses and connections were not checked against geometry.",
  );
  const identityEvidence = applyContractGate(identity.status as EvidenceStatus, identity.reason, gateReason);
  const missingRequirements = contract ? unknownsInScope(withDerivedUnknowns(contract,
    deriveRequirementContract({ request: input.contractSnapshot!.request, targetLevel: contract.targetLevel }))) : [];
  const requirementsEvidence = !contract || !input.contractGate?.evidenceCurrent || gateReason
    ? { status: "NOT_RUN" as const, reason: gateReason ?? "A confirmed requirement contract was not supplied." }
    : missingRequirements.length
      ? { status: "NOT_RUN" as const, reason: missingRequirements.map(item => `${item.id}: ${item.question}`).join(" ") }
      : { status: "PASS" as const, reason: "No in-scope requirement gaps are recorded. This does not verify geometry or physical function." };
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
    sourceMotion,
    reconstruction: { ...reconstruction, ...reconstructionEvidence, measuredStatus: reconstruction.status, measuredReason: reconstruction.reason },
    partConnectivity,
    translationProbes: { ...translationProbes, ...applyContractGate(translationProbes.status, translationProbes.reason, gateReason), measuredStatus: translationProbes.status, measuredReason: translationProbes.reason,
      results: translationProbes.results.map(probe => ({...probe,...applyContractGate(probe.status as EvidenceStatus,probe.reason,gateReason),measuredStatus:probe.status,measuredReason:probe.reason})),
    },
    declaredDisassembly: declaredDisassemblyRecord,
    declaredAssembly: {
      ...declaredAssembly,
      ...declaredAssemblyEvidence,
      measuredStatus: declaredAssembly.status,
      measuredReason: declaredAssembly.reason,
    },
    /**
     * `evidenceCurrent: null` means no contract was supplied, so the question
     * "is this the user's actual requirement" was never asked. It is not a
     * claim of approval.
     */
    contract: {
      binding: contractBinding,
      evidenceCurrent: gateReason ? false : input.contractGate ? true : null,
      reason: gateReason ?? (input.contractGate
        ? input.contractGate.reason?.trim() || "The results were judged against a confirmed requirement contract."
        : "Confirmation was not evaluated; a bound contract does not imply user approval."),
    },
    evidence: {
      requirements: requirementsEvidence,
      identity: identityEvidence,
      geometry: partConnectivity.some(p=>p.status==="FAIL")
        ? {status:"FAIL" as const,reason:partConnectivity.filter(p=>p.status==="FAIL").map(p=>`${p.partId}: ${p.reason}`).join(" ")}
        : { status: "NOT_RUN" as const, reason: "Full topology and dimensions were not independently checked; see partConnectivity for the limited surface check." },
      topology: partConnectivity.length === 0
        ? { status: "NOT_RUN" as const, reason: "No generated part meshes were available for a topology check." }
        : partConnectivity.some(p=>p.status==="FAIL")
          ? { status: "FAIL" as const, reason: partConnectivity.filter(p=>p.status==="FAIL").map(p=>`${p.partId}: ${p.reason}`).join(" ") }
          : partConnectivity.some(p=>p.status==="ERROR")
            ? { status: "ERROR" as const, reason: partConnectivity.filter(p=>p.status==="ERROR").map(p=>`${p.partId}: ${p.reason}`).join(" ") }
            : partConnectivity.every(p=>p.status==="PASS")
              ? { status: "PASS" as const, reason: "Every generated part is a single closed, consistently oriented, edge-connected surface. Dimensions, self-intersections, wall thickness, material, manufacture and physical function are not established by this topology check." }
              : { status: "NOT_RUN" as const, reason: `Topology is not certified for: ${partConnectivity.filter(p=>p.status!=="PASS").map(p=>`${p.partId} ${p.status}: ${p.reason}`).join(" ")}` },
      assembly: assemblyEvidence,
      assemblyPath: declaredAssemblyEvidence,
      reconstruction: reconstructionEvidence,
      jointFrames:jointFrameEvidence,
      disassembly: declaredPathEvidence,
      motion: motionEvidence,
      rigidMotion: rigidMotionEvidence,
      sourceMotion: sourceMotionEvidence,
      physical: { status: "NOT_RUN" as const, reason: "Physical manufacture and function were not tested." },
    },
  };
  return { spec, manifest, parts: result.parts, purchasedPartIds: result.purchasedPartIds, identity, fits, kinematics, reconstruction };
}
