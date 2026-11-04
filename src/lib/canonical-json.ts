import { createHash } from "crypto";

/**
 * Deterministic JSON: object keys are sorted, array order is preserved.
 * Two values that differ only in key order produce the same string, which is
 * what evidence and contract hashes need.
 */
export function canonicalJson(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return item;
  }
  return JSON.stringify(canonical(value));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
