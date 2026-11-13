/**
 * Connects a frozen requirement contract to the two consumers that exist today:
 * the evidence comparator and the fit measurement.
 *
 * The bridge never invents a requirement. If the contract does not assert a
 * clearance range, there is no fit requirement to measure; the unknown that
 * explains why stays in the contract.
 */
import { validateAssemblySpec } from "../assembly/assembly-spec";
import type { AssemblyFitRequirement } from "../assembly/prepare-assembly";
import type { RequirementContract } from "./requirement-contract";
import { requirementsInScope } from "./requirement-contract";

/** Structurally compatible with the comparator's `Requirement`. */
export function toEvidenceRequirements(contract: RequirementContract) {
  return requirementsInScope(contract);
}

export function toFitRequirements(
  contract: RequirementContract,
  spec: unknown,
  options: { boreInstanceId?: string; connectionId?: string } = {},
): AssemblyFitRequirement[] {
  const clearance = contract.requirements.find((requirement) => requirement.id === "diametral-clearance");
  if (!clearance) return [];
  if (clearance.expected.kind !== "range") throw new Error("The clearance requirement must be a range.");
  if (clearance.expected.unit !== "mm") throw new Error("Only millimetre clearance requirements can be measured.");

  const parsed = validateAssemblySpec(spec);
  if (!parsed.success) throw new Error("Invalid assembly specification.");
  const revolute = parsed.data.connections.filter((connection) => connection.type === "revolute");
  const connection = options.connectionId
    ? revolute.find((item) => item.id === options.connectionId)
    : revolute.length === 1 ? revolute[0] : undefined;
  if (!connection) {
    throw new Error("The declaration must contain exactly one revolute connection, or the connection must be named.");
  }
  const boreInstanceId = options.boreInstanceId ?? connection.boreInstanceId;
  if (!boreInstanceId) {
    throw new Error("The declaration does not name which instance carries the bore, and none was supplied.");
  }
  if (boreInstanceId !== connection.a && boreInstanceId !== connection.b) {
    throw new Error("The bore instance must be one of the connection's two instances.");
  }
  return [{
    connectionId: connection.id,
    boreInstanceId,
    diametralClearanceMm: { min: clearance.expected.min, max: clearance.expected.max },
  }];
}


/**
 * Product-safe binding of a confirmed/frozen contract to candidate mesh checks.
 * A joint that does not name its bore is ambiguous: never guess the role by
 * comparing diameters (that would manufacture positive clearance).
 *
 * IMPORTANT: READY means only that *candidate* geometry can be measured.
 * It does not mean the declaration's bore/shaft role was independently
 * identified. The caller must retain that uncertainty in the final verdict.
 */
export function resolveContractFitRequirements(contract: RequirementContract, spec: unknown): {
  status: "READY" | "NOT_RUN";
  required: boolean;
  reason: string;
  requirements: AssemblyFitRequirement[];
  featureIdentityStatus: "NOT_RUN";
} {
  const clearance = requirementsInScope(contract).find(item =>
    item.id === "diametral-clearance" && item.required && item.applicable);
  if (!clearance) {
    return {
      status: "NOT_RUN", required: false,
      reason: "No applicable required diametral-clearance assertion was stated.",
      requirements: [], featureIdentityStatus: "NOT_RUN",
    };
  }
  try {
    const requirements = toFitRequirements(contract, spec);
    return {
      status: "READY", required: true,
      reason: "A declared revolute connection and bore instance are available for candidate mesh measurement. Bore/shaft feature identity remains unverified.",
      requirements, featureIdentityStatus: "NOT_RUN",
    };
  } catch (error) {
    return {
      status: "NOT_RUN", required: true,
      reason: "The required clearance cannot be bound to an unambiguous declared joint and bore instance: " +
        (error instanceof Error ? error.message : "invalid feature declaration"),
      requirements: [], featureIdentityStatus: "NOT_RUN",
    };
  }
}
