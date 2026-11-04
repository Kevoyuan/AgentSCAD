import { createHash } from "crypto";
import type { AssemblySpec } from "./assembly-spec";

/** Deterministic across object-key ordering; array order remains meaningful. */
export function assemblySpecificationHash(spec: AssemblySpec): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical(spec))).digest("hex");
}
