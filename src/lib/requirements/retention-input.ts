import type { RequirementContract } from "./requirement-contract";

const ID = "axial-retention";

/** Prefer the recorded choice. Older unresolved records can reuse the original request wording. */
export function axialRetentionCondition(contract: RequirementContract, derived: RequirementContract): string {
  const recorded = contract.requirements.find(item => item.id === ID);
  if (recorded) return recorded.required ? recorded.statement ?? "" : "";
  return derived.requirements.find(item => item.id === ID)?.statement ?? "";
}

/** Records a user's condition or an explicit waiver; it never records a measurement. */
export function setAxialRetention(
  contract: RequirementContract,
  derived: RequirementContract,
  answer: { kind: "require"; condition: string } | { kind: "waive" } | { kind: "unanswered" },
): RequirementContract {
  const unknown = derived.unknowns.find(item => item.id === ID);
  const stated = derived.requirements.find(item => item.id === ID && item.layer === "assembly");
  if (!unknown?.affects.includes("assembly") && !stated) throw new Error("This request has no axial retention condition.");
  const requirements = contract.requirements.filter(item => item.id !== ID);
  const unknowns = contract.unknowns.filter(item => item.id !== ID);
  if (answer.kind === "unanswered") {
    if (!unknown) throw new Error("The request already states a retention condition. Keep it or record an explicit waiver.");
    return { ...contract, requirements, unknowns: [...unknowns, unknown] };
  }
  const condition = answer.kind === "require" ? answer.condition.trim() : "";
  if (answer.kind === "require" && (!condition || condition.length > 500)) throw new Error("Describe the required retention condition in 1–500 characters.");
  return { ...contract, unknowns, requirements: [...requirements, {
    id: ID, layer: "assembly", required: answer.kind === "require", applicable: true,
    expected: { kind: "equals", value: true }, provenance: "confirmed",
    statement: answer.kind === "require" ? condition : "Explicitly waived by user.",
  }] };
}
