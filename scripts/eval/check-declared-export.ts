#!/usr/bin/env bun
/**
 * Real export run for the declared disassembly path.
 *
 * Builds the production ZIP from one real OpenSCAD source: a confirmed
 * contract, an unconfirmed contract, and two deliberately broken release
 * sequences (guide before its retainers, and a retainer pulled without
 * turning). The point is not that the archive is produced, but that the runs
 * disagree in the way the evidence rules say they must.
 */
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { buildAssemblyBundle } from "../../src/lib/assembly/assembly-bundle";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { renderAssemblySpecParts } from "../../src/lib/tools/assembly-part-renderer";

type Manifest = {
  evidence: Record<string, { status: string; reason?: string }>;
  declaredDisassembly: { status: string; measuredStatus: string; reason: string; elapsedMs?: number; results: Array<{ status: string; reason: string }> };
  contract: { evidenceCurrent: boolean | null };
  parts: Array<{ id: string; quantity: number }>;
  instances: Array<{ id: string }>;
};

async function archive(source: string, spec: unknown, contractGate: { evidenceCurrent: boolean; reason?: string }) {
  const started = performance.now();
  const bundle = await buildAssemblyBundle({ scadSource: source, spec, contractGate });
  const files = unzipSync(bundle.zip);
  return {
    bundle,
    files,
    manifest: JSON.parse(strFromU8(files["manifest.json"])) as Manifest,
    readme: strFromU8(files["README.txt"]),
    wallMs: Math.round(performance.now() - started),
  };
}

function readmeLine(readme: string) {
  return readme.split("\n").find((line) => line.startsWith("- disassembly:"));
}

async function main() {
  const sourcePath = process.argv[2] ?? "benchmarks/assembly/slider_crank_shaft_keyed.scad";
  const source = await readFile(sourcePath, "utf8");
  const embedded = extractEmbeddedAssemblySpec(source);
  if (embedded.status !== "valid") throw new Error("The fixture has no valid embedded assembly declaration");

  const guideFirst = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-guide-first.json", "utf8"));
  const straightLock = JSON.parse(await readFile("scripts/eval/assembly-fixtures/slider-crank-keyed-lock-straight-pull.json", "utf8"));

  const confirmed = await archive(source, embedded.spec, { evidenceCurrent: true });
  const unconfirmed = await archive(source, embedded.spec, { evidenceCurrent: false, reason: "Experimental candidate; no user-confirmed requirement contract exists for it." });
  const guideFirstRun = await archive(source, guideFirst, { evidenceCurrent: true });
  const straightLockRun = await archive(source, straightLock, { evidenceCurrent: true });

  // The declared checker is measured on its own as well: the archive path is
  // synchronous, so its wall time is event-loop blocking time.
  const parts = await renderAssemblySpecParts(source, embedded.spec);
  const direct = checkDeclaredPoseDisassembly({
    spec: embedded.spec,
    meshes: Object.fromEntries(parts.parts.map((part) => [part.partId, part.stl])),
  });

  const root = path.resolve(".agentscad/experiments");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "declared-export-"));
  await writeFile(path.join(directory, "source.scad"), source);
  await writeFile(path.join(directory, "assembly-confirmed.zip"), confirmed.bundle.zip);
  await writeFile(path.join(directory, "assembly-unconfirmed.zip"), unconfirmed.bundle.zip);
  await writeFile(path.join(directory, "assembly-guide-first.zip"), guideFirstRun.bundle.zip);
  await writeFile(path.join(directory, "assembly-straight-lock.zip"), straightLockRun.bundle.zip);

  const summary = {
    directory,
    confirmed: {
      evidence: confirmed.manifest.evidence.disassembly,
      declared: { status: confirmed.manifest.declaredDisassembly.status, measuredStatus: confirmed.manifest.declaredDisassembly.measuredStatus },
      readmeLine: readmeLine(confirmed.readme),
      parts: confirmed.manifest.parts.map((part) => `${part.id}:${part.quantity}`),
      instances: confirmed.manifest.instances.length,
      wallMs: confirmed.wallMs,
    },
    unconfirmed: {
      evidence: unconfirmed.manifest.evidence.disassembly,
      declared: { status: unconfirmed.manifest.declaredDisassembly.status, measuredStatus: unconfirmed.manifest.declaredDisassembly.measuredStatus },
      readmeLine: readmeLine(unconfirmed.readme),
      wallMs: unconfirmed.wallMs,
    },
    guideFirst: {
      evidence: guideFirstRun.manifest.evidence.disassembly,
      firstFailure: guideFirstRun.manifest.declaredDisassembly.results.find((result) => result.status !== "PASS"),
      readmeLine: readmeLine(guideFirstRun.readme),
      wallMs: guideFirstRun.wallMs,
    },
    straightLock: {
      evidence: straightLockRun.manifest.evidence.disassembly,
      firstFailure: straightLockRun.manifest.declaredDisassembly.results.find((result) => result.status !== "PASS"),
      readmeLine: readmeLine(straightLockRun.readme),
      wallMs: straightLockRun.wallMs,
    },
    directCheck: { status: direct.status, elapsedMs: "elapsedMs" in direct ? direct.elapsedMs : null, budgetMs: "budgetMs" in direct ? direct.budgetMs : null, firstFailure: direct.results.find((result) => result.status !== "PASS") },
  };
  await writeFile(path.join(directory, "report.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  const ok = confirmed.manifest.evidence.disassembly.status === "PASS"
    && unconfirmed.manifest.evidence.disassembly.status === "NOT_RUN"
    && unconfirmed.manifest.declaredDisassembly.measuredStatus === "PASS"
    && guideFirstRun.manifest.evidence.disassembly.status === "FAIL"
    && straightLockRun.manifest.evidence.disassembly.status === "FAIL"
    && direct.status === "PASS";
  process.exitCode = ok ? 0 : 2;
}

main().catch((error) => { console.error(error); process.exitCode = 2; });
