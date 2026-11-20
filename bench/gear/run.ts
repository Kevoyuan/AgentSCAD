#!/usr/bin/env bun
/**
 * Runs the gear-pair family and, with `--self-check`, asserts that every
 * `reference` passes and every `adversarial-*` does not. The self-check is the
 * only thing standing between this and a benchmark that scores itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  gearSubmissionsDirectory,
  gearTasksDirectory,
  loadGearSubmissions,
  loadGearTasks,
  scoreGearSubmission,
  type GearBenchTask,
  type GearCaseReport,
} from "./bench";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const pad = (value: string, width: number) => value.padEnd(width).slice(0, width);
const cell = (value: string | number | null | undefined) => value === null || value === undefined ? "—" : String(value);

function resultCell(report: GearCaseReport, id: string): string {
  return report.results.find((result) => result.id === id)?.status ?? "—";
}

function printMatrix(reports: GearCaseReport[]): void {
  const header = [pad("task", 16), pad("submission", 28), pad("status", 8), pad("cover", 8), pad("parts", 7), pad("teeth", 10), pad("ratio", 10), pad("centre", 9)].join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const report of reports) {
    const p = report.measurements.pinion;
    const w = report.measurements.wheel;
    console.log([
      pad(report.taskId, 16),
      pad(report.submission, 28),
      pad(report.status, 8),
      pad(report.layers.coverage.ratio === null ? "—" : `${report.layers.coverage.passed}/${report.layers.coverage.observed}`, 8),
      pad(resultCell(report, "distinct-exported-parts"), 7),
      pad(p && w ? `${cell(p.toothCount)}/${cell(w.toothCount)}` : "—", 10),
      pad(cell(report.measurements.measuredRatio?.toFixed(6)), 10),
      pad(cell(report.measurements.centerDistanceMm?.toFixed(3)), 9),
    ].join(""));
  }
}

function printReasons(reports: GearCaseReport[]): void {
  for (const report of reports) {
    console.log(`\n${report.taskId} / ${report.submission} → ${report.status}`);
    if (report.measurements.parts.length > 0) {
      console.log(`  parts: ${report.measurements.parts.map((part) => `${part.partId} ${part.triangleCount}tri`).join(" | ")}`);
    }
    for (const result of report.results) console.log(`  [${pad(result.status, 7)}] ${pad(result.id, 24)} ${result.reason}`);
    console.log(`  层覆盖 ${report.layers.coverage.passed}/${report.layers.coverage.observed}（本 case 未观测 ${report.layers.coverage.unobserved.length} 层：${report.layers.coverage.unobserved.join(", ") || "无"}）`);
  }
}

async function main(): Promise<void> {
  const taskFilter = argument("--task");
  const submissionFilter = argument("--submission");
  const jsonPath = argument("--json") ?? path.join(import.meta.dir, "report.json");
  const selfCheck = process.argv.includes("--self-check");
  const verbose = process.argv.includes("--verbose");

  const tasks = await loadGearTasks();
  const selected = taskFilter ? tasks.filter((task) => task.id === taskFilter) : tasks;
  if (selected.length === 0) throw new Error(`No gear task matches "${taskFilter}"`);

  const work: Array<{ task: GearBenchTask; submission: Awaited<ReturnType<typeof loadGearSubmissions>>[number] }> = [];
  for (const task of selected) {
    const submissions = await loadGearSubmissions(task.id);
    if (submissions.length === 0) throw new Error(`Task ${task.id} has no submissions under ${path.relative(process.cwd(), path.join(gearSubmissionsDirectory(), task.id))}/`);
    for (const submission of submissions) {
      if (submissionFilter && submission.id !== submissionFilter) continue;
      work.push({ task, submission });
    }
  }
  if (work.length === 0) throw new Error(`No submission matches "${submissionFilter}"`);

  const reports: GearCaseReport[] = [];
  for (const item of work) {
    const report = await scoreGearSubmission(item.task, item.submission);
    reports.push(report);
    if (verbose) console.log(`ran ${item.task.id} / ${item.submission.id} → ${report.status}`);
  }

  printMatrix(reports);
  if (verbose || selfCheck) printReasons(reports);

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify({
    schemaVersion: "gear-bench.report.v1",
    createdAt: new Date().toISOString(),
    tasksDirectory: path.relative(process.cwd(), gearTasksDirectory()),
    summary: {
      cases: reports.length,
      passed: reports.filter((report) => report.status === "PASS").length,
      failed: reports.filter((report) => report.status === "FAIL" || report.status === "ERROR").length,
      notRun: reports.filter((report) => report.status === "NOT_RUN").length,
    },
    reports,
  }, null, 2)}\n`);

  if (selfCheck) {
    const failures: string[] = [];
    for (const report of reports) {
      if (report.expected === "pass" && report.status !== "PASS") failures.push(`${report.taskId}/${report.submission}: reference did not pass (${report.status})`);
      if (report.expected === "fail" && report.status === "PASS") failures.push(`${report.taskId}/${report.submission}: adversarial submission passed`);
    }
    if (failures.length > 0) {
      console.error(`\nSELF-CHECK FAILED:\n${failures.join("\n")}`);
      process.exitCode = 1;
      return;
    }
    const references = reports.filter((report) => report.expected === "pass").length;
    const adversarial = reports.filter((report) => report.expected === "fail").length;
    console.log(`\nSELF-CHECK OK: ${references} reference(s) pass, ${adversarial} adversarial submission(s) rejected.`);
  }
}

await main();