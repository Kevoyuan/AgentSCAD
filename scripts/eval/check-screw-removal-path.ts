#!/usr/bin/env bun
/**
 * Offline, declared-budget verification of the 12-turn screw removal path.
 *
 * The product path checker keeps its 200000 triangle-pair / 5000 ms defaults.
 * This script does not change them: it declares a larger, reported resource
 * budget explicitly, and runs a control with the product defaults so the two
 * outcomes can be compared on the very same declaration and meshes.
 *
 * The meshes are the frozen per-part STLs from a previous export experiment.
 * Their bundle hash and the declaration hash are checked before use, so a stale
 * or substituted archive cannot silently produce a PASS.
 *
 * What this can establish is narrow: every listed ideal helical pose is free of
 * triangle-level interference within the declared budget. It says nothing about
 * the gaps between poses, thread engagement, torque, fit, or a real part.
 */
import { readFile, writeFile, mkdir, mkdtemp, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { readBinaryStl } from "../../src/lib/geometry/stl-mesh";

const DEFAULT_BUNDLE = ".agentscad/experiments/screw-declaration-export-Yvpuka/assembly.zip";
const SOURCE = "benchmarks/assembly/threaded_fastener.scad";
const DECLARED_MAX_PAIR_TESTS_PER_POSE = 4_000_000;
const DECLARED_BUDGET_MS = 600_000;

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const bundlePath = process.argv[2] ?? DEFAULT_BUNDLE;
  const bundle = await readFile(bundlePath);
  const source = await readFile(SOURCE, "utf8");
  const embedded = extractEmbeddedAssemblySpec(source);
  if (embedded.status !== "valid") throw new Error("Missing valid embedded assembly specification");

  // The same 12-turn declaration that was exported in the earlier experiment.
  const spec = {
    ...embedded.spec,
    operations: [{
      id: "remove_nut", action: "disassemble" as const, instanceId: "nut", tools: [], waypoints: [],
      screwTrajectory: {
        axis: { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] },
        hand: "right" as const, leadMm: 1.5, startAngleDeg: 0, endAngleDeg: 4320,
      },
    }],
  };

  const files = unzipSync(new Uint8Array(bundle));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  const meshes: Record<string, Buffer> = {};
  for (const part of manifest.parts as Array<{ id: string; fileName: string }>) {
    const bytes = files[part.fileName];
    if (!bytes) throw new Error(`Archive is missing ${part.fileName}`);
    meshes[part.id] = Buffer.from(bytes);
  }
  if (!meshes.bolt || !meshes.nut) throw new Error("Expected frozen bolt.stl and nut.stl");

  // Bind the input to the earlier experiment before spending a long evaluation.
  const recordedPath = path.join(path.dirname(bundlePath), "report.json");
  let recorded: { bundleSha256?: string; specificationSha256?: string } | null = null;
  try { await access(recordedPath); recorded = JSON.parse(await readFile(recordedPath, "utf8")); }
  catch { recorded = null; }
  const bundleSha256 = sha(bundle);
  if (recorded?.bundleSha256 && recorded.bundleSha256 !== bundleSha256) {
    throw new Error("Bundle hash does not match the recorded export experiment");
  }
  if (recorded?.specificationSha256 && recorded.specificationSha256 !== manifest.specificationSha256) {
    throw new Error("Archive manifest hash does not match the recorded export experiment");
  }

  const triangleCounts = Object.fromEntries(Object.entries(meshes).map(([id, bytes]) => [id, readBinaryStl(bytes).triangleCount]));
  const partHashes = Object.fromEntries(Object.entries(meshes).map(([id, bytes]) => [id, sha(bytes)]));

  /** Early-return branches legitimately omit cost fields; the report shows them as null. */
  type DeclaredView = ReturnType<typeof checkDeclaredPoseDisassembly> & {
    budgetMs?: number; elapsedMs?: number;
    partHashes?: Record<string, string>; remainingInstanceIds?: string[];
  };
  // Control: identical declaration and meshes, product defaults only.
  const control = checkDeclaredPoseDisassembly({ spec, meshes }) as DeclaredView;
  // Declared run: the only differences are the explicitly reported resources.
  const declared = checkDeclaredPoseDisassembly({
    spec, meshes, offlineEvaluation: true, budgetMs: DECLARED_BUDGET_MS,
    maxPairTestsPerPose: DECLARED_MAX_PAIR_TESTS_PER_POSE,
  }) as DeclaredView;
  if (declared.specificationSha256 !== manifest.specificationSha256) {
    throw new Error("Evaluated declaration differs from the archived specification");
  }

  const trimmed = (result: DeclaredView) => ({
    status: result.status,
    reason: result.reason,
    method: result.method,
    specificationSha256: result.specificationSha256,
    maxPairTestsPerPose: result.maxPairTestsPerPose,
    offlineEvaluation: result.offlineEvaluation,
    budgetMs: result.budgetMs ?? null,
    elapsedMs: result.elapsedMs ?? null,
    partHashes: result.partHashes ?? null,
    remainingInstanceIds: result.remainingInstanceIds ?? null,
    results: result.results.map((entry) => ({
      operationId: entry.operationId,
      instanceId: entry.instanceId,
      status: entry.status,
      reason: entry.reason,
      path: entry.path ? {
        status: entry.path.status,
        reason: entry.path.reason,
        posesEvaluated: entry.path.posesEvaluated,
        posedCount: entry.path.poses.length,
        testedPairs: entry.path.testedPairs,
        maxPairTestsPerPose: entry.path.maxPairTestsPerPose,
        budgetMs: entry.path.budgetMs,
        translationStepMm: entry.path.translationStepMm,
        rotationStepDeg: entry.path.rotationStepDeg,
        coverage: entry.path.coverage,
        blockedAt: "blockedAt" in entry.path ? entry.path.blockedAt : null,
      } : null,
    })),
  });

  const report = {
    method: "declared-budget-screw-removal-path/v1",
    inputs: {
      sourcePath: SOURCE, sourceSha256: sha(source),
      bundlePath, bundleSha256, recordedBundleSha256: recorded?.bundleSha256 ?? null,
      recordedReportPath: recorded ? recordedPath : null,
      manifestSpecificationSha256: manifest.specificationSha256,
      partHashes, triangleCounts,
    },
    declaration: spec.operations[0].screwTrajectory,
    resources: {
      control: { maxPairTestsPerPose: 200000, budgetMs: 5000, offlineEvaluation: false },
      declared: { maxPairTestsPerPose: DECLARED_MAX_PAIR_TESTS_PER_POSE, budgetMs: DECLARED_BUDGET_MS, offlineEvaluation: true },
    },
    control: trimmed(control),
    declared: trimmed(declared),
    physical: { status: "NOT_RUN", reason: "No manufactured specimen was tested." },
    coverage: [
      "Only the listed ideal helical poses are checked; gaps between 5-degree samples are NOT_RUN.",
      "Meshes are frozen per-part STLs from an earlier native OpenSCAD render, hash-bound above. No re-render was performed.",
      "Triangle-pair and wall-clock budgets are declared inputs, not evidence thresholds: UNKNOWN still becomes NOT_RUN.",
    ],
    notProven: [
      "Continuous swept-volume clearance between poses.",
      "Real thread engagement, lead accuracy of a physical thread, torque, preload, fit or tool access.",
      "Coaxiality of the bore and screw axes, which remains uncalibrated.",
      "Any physical specimen, paid model call, or independent evaluation.",
    ],
  };

  const root = path.resolve(".agentscad/experiments");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "screw-removal-path-"));
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, "spec.json"), JSON.stringify(spec, null, 2));
  await writeFile(path.join(directory, "assembly.zip"), bundle);
  await writeFile(path.join(directory, "summary.json"), JSON.stringify({
    directory,
    control: { status: control.status, posesEvaluated: control.results[0]?.path?.posesEvaluated ?? 0 },
    declared: {
      status: declared.status, reason: declared.reason,
      posesEvaluated: declared.results[0]?.path?.posesEvaluated ?? 0,
      posedCount: declared.results[0]?.path?.poses.length ?? 0,
      testedPairs: declared.results[0]?.path?.testedPairs ?? 0,
      elapsedMs: declared.elapsedMs,
    },
    bundleSha256, specificationSha256: declared.specificationSha256,
  }, null, 2));
  console.log(JSON.stringify({
    directory,
    control: { status: control.status, reason: control.reason, posesEvaluated: control.results[0]?.path?.posesEvaluated },
    declared: {
      status: declared.status, reason: declared.reason,
      posesEvaluated: declared.results[0]?.path?.posesEvaluated,
      posedCount: declared.results[0]?.path?.poses.length,
      testedPairs: declared.results[0]?.path?.testedPairs,
      elapsedMs: declared.elapsedMs,
    },
  }, null, 2));
  if (declared.status !== "PASS") process.exitCode = 2;
}
main().catch((error) => { console.error(error); process.exitCode = 2; });
