import { describe, expect, test } from "bun:test";
import { deriveRequirementContract } from "./extract-requirements";
import {
  normalizeConfirmedContract,
  requirementContractHash,
  RequirementContractError,
  type ContractRequirement,
  type RequirementContract,
} from "./requirement-contract";

const REQUEST = "做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印";
const derived = () => deriveRequirementContract({ request: REQUEST });

const find = (contract: RequirementContract, id: string) => {
  const requirement = contract.requirements.find((item) => item.id === id);
  if (!requirement) throw new Error(`Missing requirement ${id}`);
  return requirement;
};

const replace = (contract: RequirementContract, id: string, patch: Partial<ContractRequirement>): RequirementContract => ({
  ...contract,
  requirements: contract.requirements.map((item) => (item.id === id ? { ...item, ...patch } : item)),
});

describe("confirming a requirement contract", () => {
  test("an unchanged contract keeps the provenance the request produced", () => {
    const normalized = normalizeConfirmedContract(derived(), derived());
    expect(find(normalized, "intent-preserved").provenance).toBe("default");
    expect(find(normalized, "diametral-clearance").provenance).toBe("request");
    // Confirmation must not change what the contract means.
    expect(requirementContractHash(normalized)).toBe(requirementContractHash(derived()));
  });

  test("tightening a range marks only that assertion as confirmed", () => {
    const edited = replace(derived(), "diametral-clearance", { expected: { kind: "range", min: 0.1, max: 0.3, unit: "mm" } });
    const normalized = normalizeConfirmedContract(edited, derived());
    expect(find(normalized, "diametral-clearance").provenance).toBe("confirmed");
    expect(find(normalized, "diametral-clearance").expected).toEqual({ kind: "range", min: 0.1, max: 0.3, unit: "mm" });
    expect(find(normalized, "disassembly-path").provenance).toBe("request");
    expect(requirementContractHash(normalized)).not.toBe(requirementContractHash(derived()));
  });

  test("a requirement the request never stated cannot be presented as coming from the request", () => {
    const added: ContractRequirement = {
      id: "wall-thickness", layer: "parts", required: true, applicable: true,
      expected: { kind: "range", min: 1.2, max: 2, unit: "mm" },
      provenance: "request", statement: "壁厚 1.2 到 2 mm",
    };
    const normalized = normalizeConfirmedContract({ ...derived(), requirements: [...derived().requirements, added] }, derived());
    expect(find(normalized, "wall-thickness").provenance).toBe("confirmed");
    // The claim is corrected, not the value: the user's number is kept as theirs.
    expect(find(normalized, "wall-thickness").expected).toEqual({ kind: "range", min: 1.2, max: 2, unit: "mm" });
  });

  test("claiming request provenance for a changed value is corrected", () => {
    const edited = replace(derived(), "distinct-exported-parts", { expected: { kind: "equals", value: 3 }, provenance: "request" });
    expect(find(normalizeConfirmedContract(edited, derived()), "distinct-exported-parts").provenance).toBe("confirmed");
  });

  test("deleting a required assertion is refused instead of silently narrowing the contract", () => {
    const truncated: RequirementContract = {
      ...derived(),
      requirements: derived().requirements.filter((item) => item.id !== "disassembly-path"),
    };
    expect(() => normalizeConfirmedContract(truncated, derived())).toThrow(RequirementContractError);
    expect(() => normalizeConfirmedContract(truncated, derived())).toThrow(/required by the request/);
  });

  test("an explicit waiver is recorded rather than rejected", () => {
    const waived = replace(derived(), "disassembly-path", { required: false });
    const normalized = normalizeConfirmedContract(waived, derived());
    const requirement = find(normalized, "disassembly-path");
    expect(requirement.required).toBe(false);
    expect(requirement.provenance).toBe("confirmed");
    // The assertion stays visible so a reader can see what was waived.
    expect(normalized.requirements).toHaveLength(derived().requirements.length);
  });

  test("reclassifying an assertion into a weaker layer is refused", () => {
    const moved = replace(derived(), "diametral-clearance", { layer: "intent" });
    expect(() => normalizeConfirmedContract(moved, derived())).toThrow(/cannot change layer/);
  });

  test("unknowns may be answered or dismissed by the user", () => {
    const answered: RequirementContract = {
      ...derived(),
      unknowns: derived().unknowns.filter((item) => item.id !== "axial-retention"),
      requirements: [...derived().requirements, {
        id: "axial-retention", layer: "assembly", required: true, applicable: true,
        expected: { kind: "equals", value: true }, provenance: "confirmed", statement: null,
      }],
    };
    const normalized = normalizeConfirmedContract(answered, derived());
    expect(normalized.unknowns.map((item) => item.id)).not.toContain("axial-retention");
    expect(find(normalized, "axial-retention").provenance).toBe("confirmed");
  });

  test("switching the target level to physical does not drop digital assertions", () => {
    const physical = normalizeConfirmedContract({ ...derived(), targetLevel: "physical" }, derived());
    expect(physical.targetLevel).toBe("physical");
    expect(physical.requirements.map((item) => item.id)).toEqual(derived().requirements.map((item) => item.id));
  });
});
