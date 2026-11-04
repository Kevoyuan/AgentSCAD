import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { collectOpenScadWarnings, renderStl, type ScadExecutionOptions } from "./scad-renderer";
import { validateAssemblySpec } from "../assembly/assembly-spec";

/** A successful render is not proof that the source honored the selector. */
export interface RenderedAssemblyPart {
  partId: string;
  stl: Buffer;
  sha256: string;
  triangleCount: number;
  diagnostics: string;
}

type RenderPart = typeof renderStl;

/** Checks the finite binary triangle table, not topology or part identity. */
function binaryTriangleCount(stl: Buffer): number {
  if (stl.length < 84) return 0;
  const count = stl.readUInt32LE(80);
  if (!count || 84 + count * 50 !== stl.length) return 0;
  for (let i = 0; i < count; i++) {
    const start = 84 + i * 50 + 12;
    for (let j = 0; j < 9; j++) if (!Number.isFinite(stl.readFloatLE(start + j * 4))) return 0;
  }
  return count;
}

/** Render into a private workspace; publish nothing unless every part succeeds. */
export async function renderAssemblyParts(input: {
  scadSource: string;
  parts: Array<{ partId: string; selector: string }>;
  /** Evaluated by OpenSCAD, so motion observations come from regenerated geometry. */
  parameters?: Record<string, number | string | boolean>;
  options?: ScadExecutionOptions;
  render?: RenderPart;
}): Promise<RenderedAssemblyPart[]> {
  if (!input.scadSource.trim()) throw new Error("Assembly source is empty");
  if (input.parts.length < 1 || input.parts.length > 64) throw new Error("Expected 1 to 64 parts");
  const validId = (id: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id);
  if (new Set(input.parts.map(part => part.partId)).size !== input.parts.length || new Set(input.parts.map(part => part.selector)).size !== input.parts.length || input.parts.some(part => !validId(part.partId) || !validId(part.selector))) {
    throw new Error("Part IDs and selectors must be unique identifiers");
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-assembly-"));
  const sourcePath = path.join(workspace, "assembly.scad");
  const render = input.render ?? renderStl;
  try {
    await fs.writeFile(sourcePath, input.scadSource, "utf8");
    const parts: RenderedAssemblyPart[] = [];
    let totalBytes = 0;
    for (const { partId, selector } of input.parts) {
      input.options?.signal?.throwIfAborted();
      const outputPath = path.join(workspace, `${partId}.stl`);
      const diagnostics = await render(sourcePath, outputPath, { ...input.parameters, agentscad_part: selector }, input.options);
      const degraded = collectOpenScadWarnings(diagnostics).find(line => /^ERROR\b/i.test(line) || /(?:can.t open (?:include|library|file)|unknown module)/i.test(line));
      if (degraded) throw new Error(`Part ${partId} has an incomplete OpenSCAD render: ${degraded}`);
      const size = (await fs.stat(outputPath)).size;
      totalBytes += size;
      if (size > 64 * 1024 * 1024 || totalBytes > 128 * 1024 * 1024) throw new Error("Assembly render exceeds the temporary output budget");
      const stl = await fs.readFile(outputPath);
      const triangleCount = binaryTriangleCount(stl);
      if (!triangleCount) throw new Error(`Part ${partId} rendered an empty or invalid STL`);
      parts.push({ partId, stl, triangleCount, diagnostics, sha256: createHash("sha256").update(stl).digest("hex") });
    }
    return parts;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

/** Purchased parts are listed separately: they cannot be rendered from this source. */
export async function renderAssemblySpecParts(scadSource: string, spec: unknown, options?: ScadExecutionOptions) {
  const parsed = validateAssemblySpec(spec);
  if (!parsed.success) throw new Error(`Invalid assembly specification: ${parsed.error.message}`);
  const generated = parsed.data.parts.filter(part => part.source === "generated");
  const purchasedPartIds = parsed.data.parts.filter(part => part.source === "purchased").map(part => part.id);
  const parts = generated.length === 0 ? [] : await renderAssemblyParts({
    scadSource,
    parts: generated.map(part => ({ partId: part.id, selector: part.selector })),
    options,
  });
  return { parts, purchasedPartIds };
}
