import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";

const START = "/* AGENTSCAD_ASSEMBLY_V1";
const END = "END_AGENTSCAD_ASSEMBLY */";
const MAX_BYTES = 1_000_000;

export type EmbeddedAssemblySpec =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "valid"; spec: AssemblySpec };

/** A model-generated contract is untrusted intent, never geometry evidence. */
export function extractEmbeddedAssemblySpec(source: string): EmbeddedAssemblySpec {
  const blocks: string[] = [];
  for (let i = 0; i < source.length;) {
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const isAssembly = source.startsWith(START, i);
      if (end < 0) return isAssembly ? { status: "invalid", reason: "Malformed assembly block" } : { status: "absent" };
      if (isAssembly) {
        const comment = source.slice(i, end + 2);
        if (!comment.endsWith(END)) return { status: "invalid", reason: "Malformed assembly block" };
        blocks.push(comment.slice(START.length, -END.length).trim());
      }
      i = end + 2;
    } else i++;
  }
  if (blocks.length === 0) return { status: "absent" };
  if (blocks.length > 1) return { status: "invalid", reason: "Multiple assembly blocks" };
  const body = blocks[0];
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) return { status: "invalid", reason: "Assembly block exceeds size limit" };
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { status: "invalid", reason: "Assembly block is not valid JSON" }; }
  const result = validateAssemblySpec(value);
  if (!result.success) return { status: "invalid", reason: "Assembly block does not match the assembly specification" };
  return { status: "valid", spec: result.data };
}
