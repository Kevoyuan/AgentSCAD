import { describe, expect, test } from "bun:test";
import { deriveRequirementContract } from "./extract-requirements";
import {
  isContractStale,
  requirementContractHash,
  RequirementContractSchema,
  requirementsInScope,
  validateRequirementContract,
} from "./requirement-contract";

const fixed = new Date("2026-10-29T10:00:00.000Z");

function derive(request: string, extra: { targetLevel?: "digital" | "physical" } = {}) {
  return deriveRequirementContract({ request, capturedAt: fixed, ...extra });
}

describe("requirement extraction from a hinge request", () => {
  test("captures parts, disassembly, motion and the stated range", () => {
    const contract = derive("做一个两件式铰链，能转 ±45°，可拆，3D 打印");
    expect(contract.intent.kind).toBe("revolute-hinge");
    const byId = Object.fromEntries(contract.requirements.map((item) => [item.id, item]));
    expect(byId["distinct-exported-parts"].expected).toEqual({ kind: "equals", value: 2 });
    expect(byId["disassembly-path"].expected).toEqual({ kind: "equals", value: true });
    expect(byId["sampled-motion"].expected).toEqual({ kind: "equals", value: true });
    expect(byId["motion-range-deg"].expected).toEqual({ kind: "atLeast", min: 45, unit: "deg" });
    expect(byId["motion-range-deg"].statement).toContain("45");
    expect(contract.requirements.every((item) => item.required && item.applicable)).toBe(true);
  });

  test("every derived requirement except the default carries a verbatim statement", () => {
    const contract = derive("做一个两件式铰链，能转 ±45°，可拆，3D 打印");
    for (const requirement of contract.requirements) {
      if (requirement.provenance === "default") {
        expect(requirement.statement).toBeNull();
      } else {
        expect(requirement.statement).toBeTruthy();
        expect("做一个两件式铰链，能转 ±45°，可拆，3D 打印").toContain(requirement.statement!);
      }
    }
  });

  test("records the gaps that the request does not settle", () => {
    const contract = derive("做一个两件式铰链，能转 ±45°，可拆，3D 打印");
    const ids = contract.unknowns.map((unknown) => unknown.id);
    expect(ids).toContain("axial-retention");
    expect(ids).toContain("material");
    expect(ids).toContain("process-parameters");
    // A 3D-printing request is not a request for physical validation.
    expect(contract.targetLevel).toBe("digital");
    expect(contract.assumptions.join(" ")).toContain("毫米");
  });

  test("never invents a clearance when the request only says it should be small", () => {
    const contract = derive("做一个铰链，间隙小一点，可拆");
    expect(contract.requirements.some((item) => item.id === "diametral-clearance")).toBe(false);
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("clearance-tolerance");
  });

  test("a stated range becomes a range requirement", () => {
    const contract = derive("两件式铰链，直径间隙 0.1 到 0.3 mm，可拆");
    const clearance = contract.requirements.find((item) => item.id === "diametral-clearance");
    expect(clearance?.expected).toEqual({ kind: "range", min: 0.1, max: 0.3, unit: "mm" });
  });

  test("a nominal plus/minus tolerance becomes a range", () => {
    const contract = derive("hinge with 0.2±0.05 mm clearance, removable");
    const clearance = contract.requirements.find((item) => item.id === "diametral-clearance");
    expect(clearance?.expected.kind).toBe("range");
    if (clearance?.expected.kind !== "range") throw new Error("expected a range");
    expect(clearance.expected.min).toBeCloseTo(0.15, 6);
    expect(clearance.expected.max).toBeCloseTo(0.25, 6);
  });

  test("a single clearance value is a question, not an acceptance range", () => {
    const contract = derive("铰链，间隙 0.2 mm");
    expect(contract.requirements.some((item) => item.id === "diametral-clearance")).toBe(false);
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("clearance-tolerance");
  });
});

describe("requirement extraction in English", () => {
  test("captures a two-part removable hinge with a rotation range", () => {
    const contract = derive("Make a two-part hinge that rotates -45 to 45 degrees and is removable, printed in PLA");
    const byId = Object.fromEntries(contract.requirements.map((item) => [item.id, item]));
    expect(contract.intent.kind).toBe("revolute-hinge");
    expect(byId["distinct-exported-parts"].expected).toEqual({ kind: "equals", value: 2 });
    expect(byId["disassembly-path"].expected).toEqual({ kind: "equals", value: true });
    expect(byId["motion-range-deg"].expected).toEqual({ kind: "atLeast", min: 45, unit: "deg" });
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("axial-retention");
  });

  test("a negated removable is not read as a requirement", () => {
    const contract = derive("A non-removable hinge, permanently fixed, no disassembly needed");
    expect(contract.requirements.some((item) => item.id === "disassembly-path")).toBe(false);
  });
});

describe("requirement extraction for other mechanisms", () => {
  test("a V8 request does not pretend to know the part count", () => {
    const contract = derive("做一个 V8 发动机装配体，八个活塞，可拆");
    expect(contract.intent.kind).toBe("multi-cylinder");
    expect(contract.requirements.some((item) => item.id === "distinct-exported-parts")).toBe(false);
    const ids = contract.unknowns.map((unknown) => unknown.id);
    expect(ids).toContain("cylinder-layout");
    expect(ids).toContain("cylinder-parts");
  });

  test("inch units are flagged instead of converted silently", () => {
    const contract = derive("make a 2 inch hinge");
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("units");
    expect(contract.requirements.some((item) => item.id === "diametral-clearance")).toBe(false);
  });

  test("a threaded request carries its own gaps", () => {
    const contract = derive("设计一个 M6 螺栓和螺母，可旋出");
    expect(contract.intent.kind).toBe("threaded");
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("thread-geometry");
  });

  test("motion without a range asks for the range", () => {
    const contract = derive("做一个能转的铰链");
    expect(contract.requirements.some((item) => item.id === "sampled-motion")).toBe(true);
    expect(contract.requirements.some((item) => item.id === "motion-range-deg")).toBe(false);
    expect(contract.unknowns.map((unknown) => unknown.id)).toContain("motion-range");
  });
});

describe("contract freezing", () => {
  test("the same request produces the same hash regardless of capture time", () => {
    const first = deriveRequirementContract({ request: "两件式铰链，可拆", capturedAt: new Date("2026-01-01T00:00:00Z") });
    const second = deriveRequirementContract({ request: "两件式铰链，可拆", capturedAt: new Date("2027-06-01T00:00:00Z"), revision: 4 });
    expect(requirementContractHash(first)).toBe(requirementContractHash(second));
  });

  test("a changed request makes the contract stale", () => {
    const contract = derive("两件式铰链，可拆");
    expect(isContractStale(contract, "两件式铰链，可拆")).toBe(false);
    expect(isContractStale(contract, "两件式铰链，可拆，承重 5kg")).toBe(true);
  });

  test("a derived contract always satisfies its own schema", () => {
    for (const request of [
      "做一个两件式铰链，能转 ±45°，可拆，3D 打印",
      "Make a two-part hinge that rotates -45 to 45 degrees and is removable",
      "V8 engine assembly with eight pistons",
      "一个支架",
    ]) {
      const contract = derive(request);
      const parsed = validateRequirementContract(contract);
      expect(parsed.success).toBe(true);
      expect(RequirementContractSchema.safeParse(JSON.parse(JSON.stringify(contract))).success).toBe(true);
    }
  });

  test("the digital scope excludes physical assertions", () => {
    const contract = derive("两件式铰链，可拆", { targetLevel: "physical" });
    expect(contract.targetLevel).toBe("physical");
    const digital = derive("两件式铰链，可拆");
    expect(requirementsInScope(digital).every((item) => item.layer !== "physical")).toBe(true);
    expect(requirementsInScope(contract)).toEqual(contract.requirements);
  });
});
