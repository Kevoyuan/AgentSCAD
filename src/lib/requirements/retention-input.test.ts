import { expect, test } from "bun:test";
import { deriveRequirementContract } from "./extract-requirements";
import { normalizeConfirmedContract } from "./requirement-contract";
import { setAxialRetention } from "./retention-input";

test("a user can record, waive and restore a retention condition without claiming a measurement", () => {
  const original = deriveRequirementContract({ request: "两件式铰链，可组装可拆卸，3D打印" });
  const required = setAxialRetention(original, original, { kind: "require", condition: "承受10N轴向拉力，按压卡扣后拆卸" });
  expect(required.unknowns.some(item => item.id === "axial-retention")).toBe(false);
  const record = required.requirements.find(item => item.id === "axial-retention")!;
  expect(record).toMatchObject({ required: true, layer: "assembly", provenance: "confirmed", statement: "承受10N轴向拉力，按压卡扣后拆卸" });
  expect(normalizeConfirmedContract(required, original).requirements.find(item => item.id === "axial-retention")?.required).toBe(true);
  const waived = setAxialRetention(required, original, { kind: "waive" });
  expect(waived.requirements.find(item => item.id === "axial-retention")?.required).toBe(false);
  expect(normalizeConfirmedContract(waived, original).requirements.find(item => item.id === "axial-retention")?.required).toBe(false);
  const pending = setAxialRetention(waived, original, { kind: "unanswered" });
  expect(pending.unknowns.some(item => item.id === "axial-retention")).toBe(true);
  expect(pending.requirements.some(item => item.id === "axial-retention")).toBe(false);
  expect(() => setAxialRetention(original, original, { kind: "require", condition: "  " })).toThrow();
  expect(() => setAxialRetention(original, original, { kind: "require", condition: "a".repeat(501) })).toThrow();
  const other = deriveRequirementContract({ request: "一个实心方块" });
  expect(() => setAxialRetention(other, other, { kind: "waive" })).toThrow();
});
