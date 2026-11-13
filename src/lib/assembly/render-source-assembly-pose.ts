import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBinaryStl } from "../geometry/stl-mesh";
import { verifyAssemblyBundle } from "./verify-assembly-bundle";
import { collectOpenScadWarnings, renderStl } from "../tools/scad-renderer";
import { usesOpenScadWasm } from "../tools/openscad-backend";

/**
 * Render a fresh reference directly from the exact source bytes whose hash is
 * stored in the downloaded ZIP. No generated-part selector is injected.
 * A matching source hash establishes snapshot consistency, not CAD correctness.
 */
export async function renderSourceAssemblyPose(input: {
  zip: Uint8Array;
  scadSource: string;
  definitions?: Record<string, number | boolean | string>;
  render?: typeof renderStl;
}): Promise<{
  stl: Buffer;
  sourceSha256: string;
  renderer: "native" | "wasm";
  definitions: Record<string, number | boolean | string>;
  warnings: string[];
}> {
  const verified = verifyAssemblyBundle(input.zip);
  const sourceSha256 = createHash("sha256").update(input.scadSource, "utf8").digest("hex");
  if (sourceSha256 !== verified.sourceSha256) {
    throw new Error("SOURCE_HASH_MISMATCH: Source SCAD does not match the ZIP sourceSha256");
  }
  if (!input.scadSource.trim()) throw new Error("Source SCAD is empty");
  const definitions = { ...input.definitions };
  if (Object.keys(definitions).some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
      Object.values(definitions).some(value => !(
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.length <= 500)
      ))) {
    throw new Error("Invalid OpenSCAD reference definitions");
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "agentscad-source-pose-"));
  const sourcePath = path.join(dir, "source.scad");
  const outputPath = path.join(dir, "source-pose.stl");
  try {
    await writeFile(sourcePath, input.scadSource, "utf8");
    const output = await (input.render ?? renderStl)(sourcePath, outputPath, definitions);
    const warnings = collectOpenScadWarnings(output);
    const fatal = warnings.find(message =>
      /^ERROR\b/i.test(message) || /(?:can.t open (?:include|library|file)|unknown module)/i.test(message));
    if (fatal) throw new Error("Reference source rendered with missing geometry: " + fatal);
    if ((await stat(outputPath)).size > 64 * 1024 * 1024) throw new Error("Reference STL exceeds 64 MiB");
    const stl = await readFile(outputPath);
    // A compiler exit alone is not sufficient evidence of a nonempty model.
    readBinaryStl(stl);
    return {
      stl, sourceSha256,
      renderer: usesOpenScadWasm() ? "wasm" : "native",
      definitions,
      warnings,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
