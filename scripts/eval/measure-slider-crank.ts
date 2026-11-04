#!/usr/bin/env bun
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { measurementExitCode } from "../../src/lib/assembly/measurement-status";
import path from "node:path";
import { sampleSliderCrankSource } from "../../src/lib/tools/slider-crank-measurement";

// Local experiment only: no model calls. Retain actual source and every observed
// mesh so independent tools can reproduce or refute the landmark measurements.
async function main() {
  const source = process.argv[2] ?? "benchmarks/assembly/slider_crank.scad";
  const setupPath = process.argv[3] ?? "scripts/eval/assembly-fixtures/slider-crank-geometry.json";
  const [scadSource, rawSetup] = await Promise.all([readFile(source, "utf8"), readFile(setupPath, "utf8")]);
  const setup = JSON.parse(rawSetup);
  const root = path.resolve(".agentscad/experiments");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "slider-crank-"));
  await writeFile(path.join(directory, "source.scad"), scadSource);
  await writeFile(path.join(directory, "setup.json"), rawSetup);
  const report = await sampleSliderCrankSource({ ...setup, scadSource,
    onArtifacts: async (angle, parts) => {
      for (const part of parts) await writeFile(path.join(directory, `${angle}-${part.partId}.stl`), part.stl);
    },
  });
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    directory, status: report.status, collision: report.collision.status, samples: report.samples.length,
    motion: report.motion === null ? null : {
      status: report.motion.status,
      crankRadiusMm: report.motion.crank?.radiusMm ?? null,
      crankResidualMm: report.motion.crank?.residualMm ?? null,
      rodLengthMm: report.motion.rodLengthMm,
      axisDriftMm: report.motion.axisDriftMm,
      coverage: report.motion.coverage,
      reason: report.motion.reason,
    },
    coverage: report.coverage,
  }, null, 2));
  process.exitCode = measurementExitCode(report.status);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
