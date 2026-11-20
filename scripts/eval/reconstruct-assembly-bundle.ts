#!/usr/bin/env bun
/**
 * Rebuild an assembly layout from a downloaded ZIP, optionally checking it
 * against a separately rendered source pose. No LLM or OpenSCAD is required.
 */
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { reconstructAssemblyBundle } from "../../src/lib/assembly/reconstruct-assembly-bundle";

function usage(): never {
  console.error("Usage: bun run cad:assembly:reconstruct <assembly.zip> <assembled.stl> [--reference <independent-pose.stl>] [--allow-partial]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();
const [inputPath, outputPath, ...flags] = args;
let referencePath: string | undefined;
let allowPartial = false;
for (let i = 0; i < flags.length; i++) {
  if (flags[i] === "--allow-partial" && !allowPartial) allowPartial = true;
  else if (flags[i] === "--reference" && !referencePath && flags[i + 1]) referencePath = flags[++i];
  else usage();
}
if ([inputPath, referencePath].filter(Boolean).some(p => path.resolve(p!) === path.resolve(outputPath))) {
  console.error("Input/reference and output must be different paths");
  process.exit(2);
}
try {
  const result = reconstructAssemblyBundle({
    zip: await readFile(inputPath),
    referenceStl: referencePath ? await readFile(referencePath) : undefined,
    allowPartial,
  });
  // Do not leave a partially written public output after a failed write.
  const tmpPath = outputPath + ".tmp-" + process.pid;
  try {
    await writeFile(tmpPath, result.stl, { flag: "wx" });
    await rename(tmpPath, outputPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
  console.log(JSON.stringify(result.report, null, 2));
  if (referencePath && result.report.reference.status !== "PASS") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "ERROR",
    code: error instanceof Error && "code" in error ? String(error.code) : "RECONSTRUCTION_FAILED",
    reason: error instanceof Error ? error.message : "Unable to reconstruct assembly",
  }, null, 2));
  process.exitCode = 1;
}
