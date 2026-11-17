import { describe, expect, test } from "bun:test";
import { resolveAssemblyReconstructionBudgetMs } from "./reconstruction-budget";

describe("assembly reconstruction budget env", () => {
  test("is unset by default so the existing 15 s default applies", () => {
    expect(resolveAssemblyReconstructionBudgetMs({})).toBeUndefined();
    expect(resolveAssemblyReconstructionBudgetMs({ AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS: "  " })).toBeUndefined();
  });

  test("accepts an explicit bounded budget", () => {
    expect(resolveAssemblyReconstructionBudgetMs({ AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS: "60000" })).toBe(60000);
  });

  test("rejects malformed or unbounded values instead of silently ignoring them", () => {
    for (const raw of ["0", "999", "120001", "abc", "1500.5", "-5"]) {
      expect(() => resolveAssemblyReconstructionBudgetMs({ AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS: raw })).toThrow("1000 to 120000");
    }
  });
});
