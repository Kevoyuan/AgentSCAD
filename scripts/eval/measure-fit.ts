#!/usr/bin/env bun
/**
 * Measures a declared revolute fit from the parts that OpenSCAD actually
 * renders. This is the reproducible entry point for the hinge experiment:
 * it prints the measured diameters, the clearance interval and the axis
 * alignment, and it never turns a measurement into a verdict on its own.
 *
 * Usage:
 *   bun scripts/eval/measure-fit.ts <source.scad> --connection <id> --bore-instance <id> \
 *     [--spec <spec.json>] [--stations 3,6,9] [--min 0.35 --max 0.45]
 *
 * Without --spec the assembly declaration embedded in the source is used.
 * With --min/--max the printed report also contains an assessment against
 * those bounds; that comparison is not a statement about function.
 */
import { readFile } from "node:fs/promises";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { assessFit, measureRevoluteFit } from "../../src/lib/assembly/fit-measurement";
import { renderAssemblySpecParts } from "../../src/lib/tools/assembly-part-renderer";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
      flags.set(item.slice(2), value);
      i++;
    } else {
      positional.push(item);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const sourcePath = positional[0];
  if (!sourcePath) throw new Error("Usage: bun scripts/eval/measure-fit.ts <source.scad> --connection <id> --bore-instance <id>");
  const connectionId = flags.get("connection");
  const boreInstanceId = flags.get("bore-instance");
  if (!connectionId || !boreInstanceId) throw new Error("--connection and --bore-instance are required");

  const scadSource = await readFile(sourcePath, "utf8");
  let spec: unknown;
  if (flags.has("spec")) {
    spec = JSON.parse(await readFile(flags.get("spec")!, "utf8"));
  } else {
    const extracted = extractEmbeddedAssemblySpec(scadSource);
    if (extracted.status !== "valid") throw new Error(`No embedded assembly declaration in ${sourcePath}; pass --spec.`);
    spec = extracted.spec;
  }

  const rendered = await renderAssemblySpecParts(scadSource, spec);
  const meshes = Object.fromEntries(rendered.parts.map((part) => [part.partId, part.stl]));
  const stations = flags.get("stations")?.split(",").map((value) => Number(value.trim()));
  if (stations && stations.some((value) => !Number.isFinite(value))) throw new Error("--stations must be a comma-separated list of numbers");

  const measurement = measureRevoluteFit({ spec, connectionId, meshes, boreInstanceId, stationsMm: stations });
  const report: Record<string, unknown> = { measurement };
  if (flags.has("min") || flags.has("max")) {
    const min = Number(flags.get("min"));
    const max = Number(flags.get("max"));
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("--min and --max must both be numbers");
    report.assessment = assessFit(measurement, { connectionId, diametralClearanceMm: { min, max } });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = measurement.status === "MEASURED" ? 0 : 2;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
