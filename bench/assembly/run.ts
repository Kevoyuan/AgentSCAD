#!/usr/bin/env bun
/**
 * Runs the task set against every submission on disk and prints the matrix.
 *
 * `--self-check` is the point of this file: it asserts that every `reference`
 * submission passes and every `adversarial-*` submission does not. If a cheat
 * starts scoring, the benchmark is broken and this exits nonzero — that is the
 * only thing standing between this and a demo that scores itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expectedOutcome, loadSubmissions, loadTasks, type BenchTask, type EvidenceStatus, type Submission } from "./bench";
import { scoreSubmission, type CaseReport } from "./score";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const pad = (value: string, width: number) => value.padEnd(width).slice(0, width);

function clearanceCell(report: CaseReport): string {
  const clearance = report.measurements.clearanceMm;
  if (!clearance) return "—";
  return `${clearance.min.toFixed(3)}-${clearance.max.toFixed(3)}`;
}

/**
 * A task that does not require a check has not failed it. Printing `NOT_RUN`
 * for an unrequired check would read as a missing measurement, which is a
 * different and more alarming fact.
 */
function requirementCell(report: CaseReport, id: string): string {
  return report.results.find((result) => result.id === id)?.status ?? "—";
}

function printMatrix(reports: CaseReport[], tasks: BenchTask[]): void {
  const header = [pad("task", 18), pad("submission", 30), pad("status", 8), pad("cover", 8), pad("parts", 7), pad("clearance", 15), pad("motion", 8), pad("disasm", 8)].join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const task of tasks) {
    for (const report of reports.filter((entry) => entry.taskId === task.id)) {
      console.log(
        [
          pad(task.id, 18),
          pad(report.submission, 30),
          pad(report.status, 8),
          pad(report.layers.coverage.ratio === null ? "—" : `${report.layers.coverage.passed}/${report.layers.coverage.observed}`, 8),
          pad(requirementCell(report, "distinct-exported-parts"), 7),
          pad(clearanceCell(report), 15),
          pad(requirementCell(report, "sampled-motion"), 8),
          pad(requirementCell(report, "disassembly-path"), 8),
        ].join(""),
      );
    }
  }
}

function printReasons(reports: CaseReport[]): void {
  for (const report of reports) {
    console.log(`\n${report.taskId} / ${report.submission} → ${report.status}`);
    if (report.measurements.parts.length > 0) {
      console.log(`  parts: ${report.measurements.parts.map((part) => `${part.partId} ${part.triangleCount}tri ${part.volumeMm3}mm³`).join(" | ")}`);
    }
    for (const result of report.results) {
      console.log(`  [${pad(result.status, 7)}] ${pad(result.id, 24)} ${result.reason}`);
    }
    const unobserved = report.layers.coverage.unobserved;
    console.log(
      `  layer coverage ${report.layers.coverage.passed}/${report.layers.coverage.observed} (${unobserved.length} layers unobserved in this case: ${unobserved.join(", ")})`,
    );
  }
}

async function main(): Promise<void> {
  const taskFilter = argument("--task");
  const submissionFilter = argument("--submission");
  const jsonPath = argument("--json") ?? path.join(import.meta.dir, "report.json");
  const selfCheck = process.argv.includes("--self-check");
  const verbose = process.argv.includes("--verbose");

  const tasks = await loadTasks();
  const selected = taskFilter ? tasks.filter((task) => task.id === taskFilter) : tasks;
  if (selected.length === 0) throw new Error(`No task matches "${taskFilter}"`);

  const work: Array<{ task: BenchTask; submission: Submission }> = [];
  for (const task of selected) {
    const submissions = await loadSubmissions(task.id);
    if (submissions.length === 0) throw new Error(`Task ${task.id} has no submissions under bench/assembly/submissions/${task.id}/`);
    for (const submission of submissions) {
      if (submissionFilter && submission.id !== submissionFilter) continue;
      work.push({ task, submission });
    }
  }
  if (work.length === 0) throw new Error(`No submission matches "${submissionFilter}"`);

  const reports: CaseReport[] = [];
  for (const { task, submission } of work) {
    const report = await scoreSubmission(task, submission);
    reports.push(report);
    if (verbose) console.log(`ran ${task.id} / ${submission.id} → ${report.status}`);
  }

  printMatrix(reports, selected);
  if (verbose || selfCheck) printReasons(reports);

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        schemaVersion: "assembly-bench.report.v1",
        createdAt: new Date().toISOString(),
        summary: {
          cases: reports.length,
          passed: reports.filter((report) => report.status === "PASS").length,
          referencesPassing: reports.filter((report) => report.expected === "pass" && report.status === "PASS").length,
          references: reports.filter((report) => report.expected === "pass").length,
          adversarialCaught: reports.filter((report) => report.expected === "fail" && report.status !== "PASS").length,
          adversarial: reports.filter((report) => report.expected === "fail").length,
        },
        cases: reports,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nreport: ${path.relative(process.cwd(), jsonPath)}`);

  if (!selfCheck) return;

  // Self-check: the benchmark must be able to tell its own answers apart.
  const failures: string[] = [];
  for (const report of reports) {
    const expected = expectedOutcome(report.submission);
    if (expected === "unscored") continue;
    if (expected === "pass" && report.status !== "PASS") {
      failures.push(`${report.taskId}/${report.submission}: reference expected PASS, observed ${report.status}`);
    }
    if (expected === "fail" && report.status === "PASS") {
      failures.push(`${report.taskId}/${report.submission}: adversarial submission scored PASS`);
    }
  }
  if (failures.length > 0) {
    console.error("\nSELF-CHECK FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nSELF-CHECK OK: ${reports.filter((report) => report.expected === "pass").length} reference(s) pass, ${reports.filter((report) => report.expected === "fail").length} adversarial submission(s) rejected.`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
