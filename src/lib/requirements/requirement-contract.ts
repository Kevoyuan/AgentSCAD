/**
 * A requirement contract is what the user asked for, frozen into machine-readable
 * assertions. It is deliberately separate from the assembly declaration (what the
 * model proposes) and from observations (what a tool measured).
 *
 * Derivation is deterministic and conservative: only explicit statements become
 * requirements. Anything mentioned but not machine-checkable becomes an unknown
 * with the question that must be answered, never a guessed number.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../canonical-json";

export const REQUIREMENT_LAYERS = ["intent", "parts", "assembly", "motion", "physical", "performance"] as const;
export type RequirementLayer = (typeof REQUIREMENT_LAYERS)[number];

/** Layers that can be settled without manufacturing a part. */
export const DIGITAL_LAYERS: ReadonlySet<RequirementLayer> = new Set(["intent", "parts", "assembly", "motion", "performance"]);

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const finite = z.number().finite();
const expected = z.union([
  z.object({ kind: z.literal("equals"), value: z.union([z.string().max(500), finite, z.boolean()]) }).strict(),
  z.object({ kind: z.literal("range"), min: finite, max: finite, unit: z.string().trim().min(1).max(20) }).strict(),
  /**
   * "At least this much", e.g. a rotation that must reach ±45°. An interval
   * cannot express it: a mechanism that turns further would fail for turning
   * further, which is not what the request asked.
   */
  z.object({ kind: z.literal("atLeast"), min: finite, unit: z.string().trim().min(1).max(20) }).strict(),
]).refine((value) => value.kind !== "range" || value.min <= value.max, "Range min must not exceed max");

export const ContractRequirementSchema = z.object({
  id,
  layer: z.enum(REQUIREMENT_LAYERS),
  required: z.boolean(),
  applicable: z.boolean(),
  expected,
  /** `default` means the pipeline asserted this, not the user. */
  provenance: z.enum(["request", "confirmed", "default"]),
  /** Exact request substring, or null when the assertion is a pipeline default. */
  statement: z.string().max(500).nullable(),
}).strict();

export const RequirementContractSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  revision: z.number().int().min(1).max(1_000_000),
  /** Binds the contract to the exact request text it was derived from. */
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
  /** `digital` stops before manufacturing; `physical` additionally asserts real-world function. */
  targetLevel: z.enum(["digital", "physical"]),
  intent: z.object({
    kind: z.enum(["single-part", "revolute-hinge", "threaded", "gear-train", "crank-slider", "multi-cylinder", "assembly"]),
    summary: z.string().trim().min(1).max(500),
  }).strict(),
  requirements: z.array(ContractRequirementSchema).max(200),
  unknowns: z.array(z.object({
    id,
    question: z.string().trim().min(1).max(500),
    affects: z.array(z.enum(REQUIREMENT_LAYERS)).max(6),
  }).strict()).max(100),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(100),
}).strict().superRefine((contract, ctx) => {
  const ids = new Set<string>();
  contract.requirements.forEach((requirement, index) => {
    if (ids.has(requirement.id)) ctx.addIssue({ code: "custom", path: ["requirements", index, "id"], message: `Duplicate requirement ID: ${requirement.id}` });
    ids.add(requirement.id);
  });
  const unknownIds = new Set<string>();
  contract.unknowns.forEach((unknown, index) => {
    if (unknownIds.has(unknown.id)) ctx.addIssue({ code: "custom", path: ["unknowns", index, "id"], message: `Duplicate unknown ID: ${unknown.id}` });
    unknownIds.add(unknown.id);
  });
});

export type ContractRequirement = z.infer<typeof ContractRequirementSchema>;
export type RequirementContract = z.infer<typeof RequirementContractSchema>;

export function validateRequirementContract(input: unknown) {
  return RequirementContractSchema.safeParse(input);
}

/**
 * Hash covers the meaning of the contract, not when it was captured or how many
 * times it was revised. Re-deriving the same request therefore yields the same
 * hash, which is what staleness checks rely on.
 */
export function requirementContractHash(contract: RequirementContract): string {
  return sha256Hex(canonicalJson({
    schemaVersion: contract.schemaVersion,
    id: contract.id,
    requestSha256: contract.requestSha256,
    targetLevel: contract.targetLevel,
    intent: contract.intent,
    requirements: contract.requirements,
    unknowns: contract.unknowns,
    assumptions: contract.assumptions,
  }));
}

/** Requirements that belong to the contract's target level. */
export function requirementsInScope(contract: RequirementContract): ContractRequirement[] {
  if (contract.targetLevel === "physical") return [...contract.requirements];
  return contract.requirements.filter((requirement) => DIGITAL_LAYERS.has(requirement.layer));
}

/**
 * A contract is stale when the request it was frozen against is no longer the
 * current request. Evidence produced under a stale contract must not be shown
 * as current.
 */
export function isContractStale(contract: RequirementContract, currentRequest: string): boolean {
  return contract.requestSha256 !== sha256Hex(currentRequest.trim());
}

/** A contract operation that must be refused for a reason the caller can explain. */
export class RequirementContractError extends Error {
  constructor(message: string, readonly status: 409 | 400 = 409) {
    super(message);
    this.name = "RequirementContractError";
  }
}

const confirmationShape = (requirement: ContractRequirement) => canonicalJson({
  layer: requirement.layer,
  required: requirement.required,
  applicable: requirement.applicable,
  expected: requirement.expected,
  statement: requirement.statement,
});

/**
 * Recomputes provenance and rejects omissions when a user confirms a contract.
 *
 * Confirmation is where a contract becomes binding, so it is also where a
 * contract is most easily weakened by accident. Two rules apply:
 *
 * - A required assertion cannot disappear. Removing it is only accepted by
 *   keeping it with `required: false` or `applicable: false`, which records the
 *   waiver instead of erasing the requirement.
 * - Provenance is recomputed, never trusted. Anything differing from a fresh
 *   derivation is `confirmed` because a human changed it, and a value the
 *   request never stated can never be presented as coming from the request.
 *
 * The layer is locked because it decides which evidence is allowed to settle
 * the assertion; reclassifying a physical requirement as a digital one would
 * lower the bar without changing any visible number.
 */
export function normalizeConfirmedContract(submitted: RequirementContract, derived: RequirementContract): RequirementContract {
  const derivedById = new Map(derived.requirements.map((requirement) => [requirement.id, requirement]));
  const submittedIds = new Set(submitted.requirements.map((requirement) => requirement.id));

  for (const original of derived.requirements) {
    if (!original.required || submittedIds.has(original.id)) continue;
    throw new RequirementContractError(
      `Requirement "${original.id}" is required by the request. To drop it, keep it in the contract with required=false or applicable=false so the waiver is recorded.`,
    );
  }

  const requirements = submitted.requirements.map((requirement) => {
    const original = derivedById.get(requirement.id);
    if (!original) return { ...requirement, provenance: "confirmed" as const };
    if (original.layer !== requirement.layer) {
      throw new RequirementContractError(
        `Requirement "${requirement.id}" cannot change layer from ${original.layer} to ${requirement.layer}: the layer decides which evidence is allowed to settle it.`,
      );
    }
    if (confirmationShape(original) === confirmationShape(requirement)) return { ...requirement, provenance: original.provenance };
    return { ...requirement, provenance: "confirmed" as const };
  });

  return { ...submitted, requirements };
}
