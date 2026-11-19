#!/usr/bin/env bun
/**
 * Runs an external hidden set and writes an aggregate-only report.
 *
 * Usage:
 *   bun run bench:hidden -- --hidden /path/outside/repo [--json /tmp/hidden-report.json] [--self-check]
 *
 * The hidden directory must contain:
 *   hidden.json
 *   tasks/*.json
 *   submissions/<task-id>/*.scad
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateHiddenReport,
  assertExternalHiddenDirectory,
  defaultHiddenReportPath,
  loadHiddenSet,
  type HiddenFamily,
  type HiddenTask,
} from "./hidden";
import { type BenchTask, type EvidenceStatus, type ExpectedOutcome } from "./bench";
import { scoreSubmission } from "./score";
import { scoreGearSubmission, type GearBenchTask } from "../gear/bench";
import { scoreSliderSubmission, type SliderBenchTask } from "../slider/bench";
import { scoreL4Submission, type L4BenchTask } from "../l4/bench";
import { scoreTwinSubmission, type TwinBenchTask } from "../twin/bench";
import { scoreVTwinSubmission, type VTwinBenchTask } from "../vtwin/bench";
import { scoreDeclarationSubmission, type DeclarationBenchTask } from "../declaration/bench";
import { scoreV8Submission, type V8BenchTask } from "../v8/bench";
import { scorePlanetarySubmission, type PlanetaryBenchTask } from "../planetary/bench";
import { scorePlanetary3Submission, type Planetary3Task } from "../planetary3/bench";
import { scoreProductSubmission, type ProductTask } from "../product/bench";
import { scoreThreadSubmission, type ThreadTask } from "../thread/bench";
import { scoreCamSubmission, type CamTask } from "../cam/bench";

interface HiddenReport {
  taskId: string;
  submission: string;
  expected: ExpectedOutcome;
  status: EvidenceStatus;
  layers: { coverage: { passed: number; observed: number } };
}

async function scoreFamily(family: HiddenFamily, task: HiddenTask, submission: Awaited<ReturnType<typeof loadHiddenSet>>["submissions"] extends Map<string, Array<infer T>> ? T : never): Promise<HiddenReport> {
  switch (family) {
    case "assembly": return scoreSubmission(task as BenchTask, submission);
    case "gear": return scoreGearSubmission(task as GearBenchTask, submission);
    case "slider": return scoreSliderSubmission(task as SliderBenchTask, submission);
    case "l4": return scoreL4Submission(task as L4BenchTask, submission);
    case "twin": return scoreTwinSubmission(task as TwinBenchTask, submission);
    case "vtwin": return scoreVTwinSubmission(task as VTwinBenchTask, submission);
    case "declaration": return scoreDeclarationSubmission(task as DeclarationBenchTask, submission);
    case "v8": return scoreV8Submission(task as V8BenchTask, submission);
    case "planetary": return scorePlanetarySubmission(task as PlanetaryBenchTask, submission);
    case "planetary3": return scorePlanetary3Submission(task as Planetary3Task, submission);
    case "product": return scoreProductSubmission(task as ProductTask, submission);
    case "thread": return scoreThreadSubmission(task as ThreadTask, submission);
    case "cam": return scoreCamSubmission(task as CamTask, submission);
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const directory = argument("--hidden");
  if (!directory) throw new Error("Usage: bun run bench:hidden -- --hidden <external-dir> [--json <path>] [--self-check] [--require-independent]");
  const hidden = await loadHiddenSet(directory);
  const jsonPath = path.resolve(argument("--json") ?? defaultHiddenReportPath());
  assertExternalHiddenDirectory(path.dirname(jsonPath));
  const selfCheck = process.argv.includes("--self-check");
  const requireIndependent = process.argv.includes("--require-independent");

  const reports: HiddenReport[] = [];
  for (const task of hidden.tasks) {
    for (const submission of hidden.submissions.get(task.id) ?? []) {
      reports.push(await scoreFamily(hidden.manifest.family, task, submission));
    }
  }

  const aggregate = aggregateHiddenReport(hidden.manifest, reports);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`);

  console.log(`hidden set: ${aggregate.hiddenId} [${aggregate.family}] (${aggregate.summary.tasks} task(s), ${aggregate.summary.cases} case(s))`);
  console.log(`independent declaration: ${aggregate.independent ? "true (declared, not verified)" : "false"} — ${aggregate.independentHiddenEvaluation}`);
  console.log(`result: ${aggregate.summary.passed} PASS / ${aggregate.summary.failed} FAIL-ERROR / ${aggregate.summary.notRun} NOT_RUN`);
  for (const task of aggregate.tasks) {
    console.log(`  ${task.taskId}: ${task.passed}/${task.cases} PASS, layers ${task.layers.passed}/${task.layers.observed}`);
  }
  console.log(`report: ${jsonPath}`);

  if (selfCheck) {
    const failures: string[] = [];
    for (const report of reports) {
      if (report.expected === "pass" && report.status !== "PASS") failures.push(`${report.taskId}: reference expected PASS, observed ${report.status}`);
      if (report.expected === "fail" && report.status === "PASS") failures.push(`${report.taskId}: adversarial submission scored PASS`);
    }
    if (failures.length > 0) {
      console.error(`\nHIDDEN SELF-CHECK FAILED\n${failures.join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log(`\nHIDDEN SELF-CHECK OK: ${reports.filter((report) => report.expected === "pass").length} reference(s) pass, ${reports.filter((report) => report.expected === "fail").length} adversarial submission(s) rejected.`);
    }
  }

  if (requireIndependent && !aggregate.independent) {
    console.error("\nNOT AN INDEPENDENT HIDDEN EVALUATION: the manifest declares independent: false.");
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
