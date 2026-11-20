import { expect, test } from "bun:test";
import { deriveRequirementContract } from "./extract-requirements";
import { normalizeConfirmedContract } from "./requirement-contract";
import { axialRetentionCondition, setAxialRetention } from "./retention-input";

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

test("a stated request condition can be edited or waived while an old unresolved record stays recoverable", () => {
  const derived = deriveRequirementContract({ request: "两件式可拆铰链，工作姿态必须有几何轴向防脱。" });
  const legacy = {
    ...derived,
    requirements: derived.requirements.filter(item => item.id !== "axial-retention"),
    unknowns: [...derived.unknowns, {
      id: "axial-retention", question: "轴向保持方式未说明", affects: ["assembly" as const, "motion" as const],
    }],
  };
  const original = derived.requirements.find(item => item.id === "axial-retention")!;
  expect(axialRetentionCondition(legacy, derived)).toBe(original.statement!);
  const recovered = setAxialRetention(legacy, derived, { kind: "require", condition: axialRetentionCondition(legacy, derived) });
  expect(recovered.unknowns.some(item => item.id === "axial-retention")).toBe(false);
  expect(normalizeConfirmedContract(recovered, derived).requirements.find(item => item.id === "axial-retention")?.provenance).toBe("request");
  const edited = setAxialRetention(derived, derived, { kind: "require", condition: "工作时轴向防脱，先按压再旋转释放" });
  expect(axialRetentionCondition(edited, derived)).toContain("先按压");
  expect(normalizeConfirmedContract(edited, derived).requirements.find(item => item.id === "axial-retention")?.provenance).toBe("confirmed");
  const waived = setAxialRetention(derived, derived, { kind: "waive" });
  expect(axialRetentionCondition(waived, derived)).toBe("");
  expect(normalizeConfirmedContract(waived, derived).requirements.find(item => item.id === "axial-retention")?.required).toBe(false);
  expect(() => setAxialRetention(derived, derived, { kind: "unanswered" })).toThrow("already states");
});
