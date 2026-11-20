import { expect, test } from "bun:test";
import { deriveRequirementContract } from "./extract-requirements";
import { requirementContractHash } from "./requirement-contract";
import { confirmedRequirementContext } from "./confirmed-context";
import { setAxialRetention } from "./retention-input";

test("only the exact current confirmation is sent as design data, never as verification", () => {
  const derived = deriveRequirementContract({ request: "两件式铰链，可组装可拆卸" });
  const contract = setAxialRetention(derived, derived, { kind: "require", condition: "抵抗轴向10N，按压后拆卸" });
  const record = { confirmed: true, stale: false, evidenceCurrent: true, confirmedContractSha256: requirementContractHash(contract), contract, derived };
  const context = confirmedRequirementContext(record)!;
  expect(context.text).toContain("抵抗轴向10N，按压后拆卸");
  expect(context.text).toContain("not verified facts");
  expect(confirmedRequirementContext({ ...record, confirmed: false })).toBeNull();
  expect(confirmedRequirementContext({ ...record, stale: true })).toBeNull();
  expect(confirmedRequirementContext({ ...record, evidenceCurrent: false })).toBeNull();
  expect(() => confirmedRequirementContext({ ...record, confirmedContractSha256: "a".repeat(64) })).toThrow(/fingerprint/);
  const different = deriveRequirementContract({ request: "其他请求" });
  expect(() => confirmedRequirementContext({ ...record, derived: different })).toThrow(/fingerprint/);
  expect(() => confirmedRequirementContext({ ...record, confirmed: false, evidenceCurrent: false,
    reason: "The stored contract could not be read, so nothing counts as confirmed." })).toThrow(/cannot be read/);
});

test("a legacy confirmation that silently omitted an unknown keeps that unknown in the model context", () => {
  const derived = deriveRequirementContract({ request: "两件式铰链，可拆卸" });
  const contract = { ...derived, unknowns: derived.unknowns.filter(item => item.id !== "axial-retention") };
  const context = confirmedRequirementContext({ confirmed: true, stale: false, evidenceCurrent: true,
    confirmedContractSha256: requirementContractHash(contract), contract, derived });
  expect(context?.text).toContain("axial-retention");
});
