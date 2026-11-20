import { createHash } from "node:crypto";
import { extractEmbeddedAssemblySpec } from "../assembly/embedded-spec";
import { prepareContractAssembly } from "../assembly/prepare-contract-assembly";
import { automaticHingeKinematics } from "../assembly/automatic-hinge-kinematics";
import { collectAssemblyFindings } from "../assembly/repair-findings";
import { deriveRequirementContract } from "../requirements/extract-requirements";
import { toFitRequirements } from "../requirements/contract-bridge";
import { readRequirementContract } from "../requirements/requirement-contract-record";
import { requirementsInScope, unknownsInScope, withDerivedUnknowns, type RequirementContract } from "../requirements/requirement-contract";
import type { ValidationResult } from "../mesh-validator";
import { assessAssemblyRequirements, hasAssemblyRequirementAssertion, type AssemblyRequirementAssertion } from "./assembly-requirement-assertions";
import {diagnoseAssemblySource,summarizeAssemblySourceDiagnostics,type AssemblySourceDiagnostics} from "../assembly/source-diagnostics";

export interface AssemblyValidationResult extends ValidationResult {
  assemblyDiagnostics?:AssemblySourceDiagnostics;
  assemblyEvidence?: {
    sourceSha256: string;
    manifest: Awaited<ReturnType<typeof prepareContractAssembly>>["manifest"];
    requirements: AssemblyRequirementAssertion[];
  };
}

/** Confirmed assertions without an implementation remain unmeasured. */
export function unverifiedAssemblyRequirements(contract: RequirementContract) {
  const supported = (requirement: RequirementContract["requirements"][number]) =>
    requirement.expected.kind === "equals" && requirement.expected.value === true
    && ((requirement.layer === "assembly" && ["assembly-path", "disassembly-path"].includes(requirement.id))
      || (requirement.layer === "motion" && requirement.id === "sampled-motion"));
  return requirementsInScope(contract).filter(requirement => requirement.layer !== "intent"
    && requirement.required && requirement.applicable && !supported(requirement) && !hasAssemblyRequirementAssertion(requirement.id));
}

/** Required digital checks remain visible even when unavailable or unconfirmed. */
export async function validateAssemblyArtifact(input: {
  jobId?: string;
  inputRequest: string;
  scadSource: string;
  signal?: AbortSignal;
}, prepare = prepareContractAssembly, diagnose = diagnoseAssemblySource): Promise<AssemblyValidationResult[]> {
  const extracted = extractEmbeddedAssemblySpec(input.scadSource);
  const derived = deriveRequirementContract({ request: input.inputRequest });
  const requiresAssembly = derived.requirements.some(requirement =>
    requirement.id === "assembly-path" || requirement.id === "disassembly-path"
    || (requirement.id === "distinct-exported-parts" && requirement.expected.kind === "equals" && Number(requirement.expected.value) > 1));
  if (extracted.status === "absent" && !requiresAssembly) return [];
  const row = (status: AssemblyValidationResult["status"], message: string): AssemblyValidationResult => ({
    rule_id: "A001", rule_name: "Assembly contract evidence", level: "ENGINEERING",
    status, passed: status === "PASS", is_critical: true, message,
  });
  if (extracted.status !== "valid") {
    if(extracted.status==="absent")return [row("FAIL","The requested assembly has no embedded assembly declaration. Preserve all required parts and provide complete selectors, placements, connections and operations.")];
    try {
      const {report}=await diagnose({scadSource:input.scadSource,signal:input.signal});
      return [{...row("FAIL",`${extracted.reason}\n${summarizeAssemblySourceDiagnostics(report)}`),assemblyDiagnostics:report}];
    }catch(error){input.signal?.throwIfAborted();return [row("FAIL",`${extracted.reason}\nPartial diagnostics unavailable: ${String(error).slice(0,1000)}`)];}
  }
  try {
    const record = input.jobId ? await readRequirementContract(input.jobId, input.inputRequest) : null;
    const contract = record?.contract ?? derived;
    const confirmed = record?.evidenceCurrent === true;
    const spec = extracted.spec;
    if (spec.instances.length > 8) return [row("NOT_RUN", "Automatic assembly verification is bounded to eight instances. Use explicit verification for this assembly.")];
    const hinge = spec.connections.length === 1 && spec.connections[0].type === "revolute"
      && spec.connections[0].boreInstanceId && contract.intent.kind === "revolute-hinge";
    const clearance = contract.requirements.some(requirement => requirement.id === "diametral-clearance" && requirement.required && requirement.applicable);
    const prepared = await prepare({
      scadSource: input.scadSource, spec,
      contractSnapshot: { contract, request: input.inputRequest },
      contractGate: { evidenceCurrent: confirmed },
      fitRequirements: hinge && clearance ? toFitRequirements(contract, spec) : undefined,
      kinematics: hinge ? automaticHingeKinematics(spec) : undefined,
      options: { signal: input.signal },
    });
    const layers = new Set(["identity", "reconstruction", "assembly"]);
    for (const requirement of contract.requirements.filter(item => item.required && item.applicable)) {
      if (requirement.id === "assembly-path") layers.add("assemblyPath");
      if (requirement.id === "disassembly-path") layers.add("disassembly");
      if (requirement.id === "sampled-motion") layers.add("motion");
    }
    if (spec.connections.some(connection => connection.type === "revolute")) layers.add("jointFrames");
    const evidence = prepared.manifest.evidence;
    const selected = Object.entries(evidence).filter(([layer]) => layers.has(layer));
    const failures = selected.filter(([, item]) => item.status === "FAIL");
    const disconnected = prepared.manifest.partConnectivity.filter(part => part.status === "FAIL");
    const unresolvedParts = prepared.manifest.partConnectivity.filter(part => part.status !== "PASS");
    const unresolvedRequirements = unknownsInScope(withDerivedUnknowns(contract, derived));
    const uncheckedRequirements = unverifiedAssemblyRequirements(contract);
    const assertions = assessAssemblyRequirements(contract, spec, prepared);
    const status = failures.length || disconnected.length || assertions.some(item => item.status === "FAIL") ? "FAIL"
      : selected.some(([, item]) => item.status === "ERROR") || assertions.some(item => item.status === "ERROR") ? "ERROR"
      : selected.length !== layers.size || selected.some(([, item]) => item.status !== "PASS")
        || assertions.some(item => item.status !== "PASS") || unresolvedParts.length || unresolvedRequirements.length || uncheckedRequirements.length ? "NOT_RUN" : "PASS";
    const findings = collectAssemblyFindings({ manifest: prepared.manifest, kinematics: prepared.kinematics });
    const details = selected.map(([layer, item]) => `${layer} ${item.status}: ${item.reason}`);
    details.push(...unresolvedParts.map(part => `${part.partId} connectivity ${part.status}: ${part.reason}`));
    details.push(...unresolvedRequirements.map(unknown => `requirement ${unknown.id} NOT_RUN: ${unknown.question}`));
    details.push(...uncheckedRequirements.map(requirement => `requirement ${requirement.id} NOT_RUN: No automatic assertion is implemented for this requirement.`));
    details.push(...assertions.map(assertion => `requirement ${assertion.id} ${assertion.status}: ${assertion.reason}`));
    details.push("Digital evidence only: this verdict does not establish physical function, manufacturing tolerance or user acceptance.");
    return [{ ...row(status, [...details, ...findings.map(finding => finding.message)].join("\n")),
      assemblyEvidence: { sourceSha256: createHash("sha256").update(input.scadSource).digest("hex"), manifest: prepared.manifest, requirements: assertions } }];
  } catch (error) {
    input.signal?.throwIfAborted();
    return [row("ERROR", `Assembly verification unavailable: ${error instanceof Error ? error.message : String(error)}`)];
  }
}
