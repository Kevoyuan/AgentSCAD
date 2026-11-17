/**
 * Complex assemblies can need more than the 15 s reconstruction budget on a
 * slow host. This is an operations knob, not evidence: the measurement and its
 * PASS/FAIL semantics are unchanged, only the timeout is extended.
 */
export const DEFAULT_ASSEMBLY_RECONSTRUCTION_BUDGET_MS = 15_000;
export const MAX_ASSEMBLY_RECONSTRUCTION_BUDGET_MS = 120_000;

export function resolveAssemblyReconstructionBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  const raw = env.AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > MAX_ASSEMBLY_RECONSTRUCTION_BUDGET_MS)
    throw new Error("AGENTSCAD_ASSEMBLY_RECONSTRUCTION_BUDGET_MS must be an integer from 1000 to 120000 milliseconds");
  return value;
}
