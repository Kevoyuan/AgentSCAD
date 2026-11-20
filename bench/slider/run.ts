#!/usr/bin/env bun
/**
 * Runs the slider-crank family and, with `--self-check`, asserts that the
 * reference passes and every adversarial submission does not.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadSliderSubmissions,
  loadSliderTasks,
  scoreSliderSubmission,
  sliderSubmissionsDirectory,
  sliderTasksDirectory,
  type SliderBenchTask,
  type SliderCaseReport,
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

function resultCell(report: SliderCaseReport, id: string): string {
  return report.results.find((result) => result.id === id)?.status ?? "—";
}

function printMatrix(reports: SliderCaseReport[]): void {
  const header = [pad("task", 20), pad("submission", 30), pad("status", 8), pad("cover", 7), pad("parts", 6), pad("landmark", 9), pad("collide", 8), pad("source", 7), pad("crank", 8), pad("rod", 8)].join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const report of reports) {
    console.log([
      pad(report.taskId, 20),
      pad(report.submission, 30),
      pad(report.status, 8),
      pad(report.layers.coverage.ratio === null ? "—" : `${report.layers.coverage.passed}/${report.layers.coverage.observed}`, 7),
      pad(resultCell(report, "distinct-exported-parts"), 6),
      pad(resultCell(report, "measured-joint-frames"), 9),
      pad(resultCell(report, "sampled-motion"), 8),
      pad(resultCell(report, "source-motion"), 7),
      pad(cell(report.measurements.crankRadiusMm?.toFixed(3)), 8),
      pad(cell(report.measurements.rodLengthSpreadMm?.toFixed(3)), 8),
    ].join(""));
  }
}

function printReasons(reports: SliderCaseReport[]): void {
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

  const tasks = await loadSliderTasks();
  const selected = taskFilter ? tasks.filter((task) => task.id === taskFilter) : tasks;
  if (selected.length === 0) throw new Error(`No slider task matches "${taskFilter}"`);

  const work: Array<{ task: SliderBenchTask; submission: Awaited<ReturnType<typeof loadSliderSubmissions>>[number] }> = [];
  for (const task of selected) {
    const submissions = await loadSliderSubmissions(task.id);
    if (submissions.length === 0) throw new Error(`Task ${task.id} has no submissions under ${path.relative(process.cwd(), path.join(sliderSubmissionsDirectory(), task.id))}/`);
    for (const submission of submissions) {
      if (submissionFilter && submission.id !== submissionFilter) continue;
      work.push({ task, submission });
    }
  }
  if (work.length === 0) throw new Error(`No submission matches "${submissionFilter}"`);

  const reports: SliderCaseReport[] = [];
  for (const item of work) {
    const report = await scoreSliderSubmission(item.task, item.submission);
    reports.push(report);
    if (verbose) console.log(`ran ${item.task.id} / ${item.submission.id} → ${report.status}`);
  }

  printMatrix(reports);
  if (verbose || selfCheck) printReasons(reports);

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify({
    schemaVersion: "slider-bench.report.v1",
    createdAt: new Date().toISOString(),
    tasksDirectory: path.relative(process.cwd(), sliderTasksDirectory()),
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
