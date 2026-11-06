/** Mark an old A001 verdict stale without manufacturing or deleting evidence. */
export function staleAssemblyValidation(serialized: string | null, contractSha256: string): string | null {
  if (!serialized) return null;
  let rows: unknown;
  try { rows = JSON.parse(serialized); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  let changed = false;
  const next = rows.map((value) => {
    if (!value || typeof value !== "object" || value.rule_id !== "A001") return value;
    changed = true;
    const previous = value.staleAssemblyValidation ?? { status: value.status ?? null, passed: value.passed, message: value.message };
    return { ...value, status: "NOT_RUN", passed: false,
      message: "Confirmed requirements changed. Assembly evidence is stale; run the checks again.",
      staleAssemblyValidation: previous, invalidatedByContractSha256: contractSha256 };
  });
  return changed ? JSON.stringify(next) : null;
}
