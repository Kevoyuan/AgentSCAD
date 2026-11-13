#!/usr/bin/env bun
/** Verify an already-exported assembly archive without invoking an LLM or CAD renderer. */
import { readFile } from "node:fs/promises";
import {
  AssemblyBundleVerificationError,
  verifyAssemblyBundle,
} from "../../src/lib/assembly/verify-assembly-bundle";

async function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    console.error("Usage: bun run cad:assembly:verify path/to/assembly.zip");
    process.exitCode = 2;
    return;
  }
  try {
    const result = verifyAssemblyBundle(await readFile(file));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const known = error instanceof AssemblyBundleVerificationError;
    console.error(JSON.stringify({
      status: "FAIL",
      code: known ? error.code : "READ_FAILED",
      reason: error instanceof Error ? error.message : "Unable to read or verify archive",
    }, null, 2));
    process.exitCode = 1;
  }
}
await main();
