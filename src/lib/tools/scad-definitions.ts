export function formatOpenScadDefinition(
  value: unknown
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return null;
}

export function getOpenScadDefinitionEntries(
  definitions?: Record<string, unknown>
): Array<[string, string]> {
  if (!definitions) return [];
  return Object.entries(definitions).flatMap(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return [];
    const formatted = formatOpenScadDefinition(value);
    return formatted === null ? [] : [[key, formatted]];
  });
}
