import type { AssemblySpec } from "../assembly/assembly-spec";
import type { prepareContractAssembly } from "../assembly/prepare-contract-assembly";
import { requirementsInScope, type ContractRequirement, type RequirementContract } from "../requirements/requirement-contract";

type Prepared = Awaited<ReturnType<typeof prepareContractAssembly>>;
export interface AssemblyRequirementAssertion {
  id: string;
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
}

const handled = new Set(["distinct-exported-parts", "motion-range-deg", "motion-range-negative-end", "motion-range-positive-end", "diametral-clearance"]);
export const hasAssemblyRequirementAssertion = (id: string) => handled.has(id);

/** Compare only observations produced for this candidate with the frozen requirement. */
export function assessAssemblyRequirements(contract: RequirementContract, spec: AssemblySpec, prepared: Prepared): AssemblyRequirementAssertion[] {
  const evidence = prepared.manifest.evidence;
  const compare = (requirement: ContractRequirement): AssemblyRequirementAssertion => {
    const result = (status: AssemblyRequirementAssertion["status"], reason: string) => ({ id: requirement.id, status, reason });
    if (requirement.id === "distinct-exported-parts") {
      if (requirement.expected.kind !== "equals" || typeof requirement.expected.value !== "number"
          || !Number.isInteger(requirement.expected.value) || requirement.expected.value < 1)
        return result("ERROR", "The requested number of distinct exports is invalid.");
      if (!Array.isArray(prepared.parts)) return result("NOT_RUN", "Part exports were not captured.");
      const count = prepared.parts.length, expected = requirement.expected.value;
      if (count < expected) return result("FAIL", `Only ${count} generated part designs were exported; ${expected} distinct exports were requested.`);
      if (evidence.identity.status !== "PASS") return result("NOT_RUN", `Cannot establish ${count} distinct exported designs: ${evidence.identity.reason}`);
      if (count !== expected) return result("FAIL", `${count} distinct part designs were exported; the frozen requirement is ${expected}.`);
      return result("PASS", `${count} selected part designs produced distinct contained meshes. Their intended identity and manufacturing quality remain unverified.`);
    }
    if (requirement.id === "diametral-clearance") {
      if (requirement.expected.kind !== "range" || requirement.expected.unit !== "mm")
        return result("NOT_RUN", "The fit checker supports a bounded diametral clearance in millimetres only.");
      if (spec.connections.length !== 1 || spec.connections[0].type !== "revolute")
        return result("NOT_RUN", "A single declared revolute connection is required for this fit check.");
      const fits = prepared.fits.filter(fit => fit.connectionId === spec.connections[0].id);
      if (fits.length !== 1) return result("NOT_RUN", "No unique fit measurement was produced for the requested joint.");
      const fit = fits[0];
      if (fit.status !== "PASS") return result(fit.status, fit.reason);
      const measured = fit.diametralClearanceMm;
      if (fit.measuredStatus !== "PASS" || !measured || !Number.isFinite(measured.min) || !Number.isFinite(measured.max)
          || measured.min > measured.max || !fit.stationsMm.length || fit.stationsMm.some(station => !Number.isFinite(station)))
        return result("ERROR", "The passing fit record has no valid measured interval and stations.");
      const wanted = requirement.expected;
      if (measured.max < wanted.min || measured.min > wanted.max)
        return result("FAIL", `Measured diametral clearance ${measured.min}–${measured.max} mm is outside ${wanted.min}–${wanted.max} mm.`);
      if (measured.min < wanted.min || measured.max > wanted.max)
        return result("ERROR", `Measured clearance ${measured.min}–${measured.max} mm crosses the requested band ${wanted.min}–${wanted.max} mm.`);
      return result("PASS", `Measured ${measured.min}–${measured.max} mm at ${fit.stationsMm.length} axial stations, within ${wanted.min}–${wanted.max} mm; unsampled geometry and manufacturing remain unverified.`);
    }
    if (requirement.expected.kind !== "atLeast" || requirement.expected.unit !== "deg")
      return result("NOT_RUN", "The motion coverage checker supports degree lower bounds only.");
    const motion = prepared.kinematics?.motion;
    if (evidence.motion.status !== "PASS" || evidence.sourceMotion?.status !== "PASS" || motion?.status !== "PASS" || !motion.rangeDeg)
      return result("NOT_RUN", `Requested range needs both source-driven pose and ideal rigid-pose evidence: ${evidence.motion.reason}`);
    const { min, max } = motion.rangeDeg;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
      return result("ERROR", "The measured motion interval is invalid.");
    const value = requirement.id === "motion-range-negative-end" ? -min
      : requirement.id === "motion-range-positive-end" ? max : Math.max(Math.abs(min), Math.abs(max));
    const detail = `Ideal rigid-pose samples cover ${min}° to ${max}°; ${requirement.id} requires at least ${requirement.expected.min}°.`;
    return value >= requirement.expected.min
      ? result("PASS", `${detail} Listed source inputs also matched expected poses. Continuous clearance and physical stops remain unverified.`)
      : result("FAIL", `${detail} The declared sampled interval is too short; this does not prove a physical stop.`);
  };
  return requirementsInScope(contract).filter(requirement => requirement.required && requirement.applicable && handled.has(requirement.id)).map(compare);
}
