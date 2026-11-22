#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadV8Submissions, loadV8Tasks, scoreV8Submission, v8SubmissionsDirectory, v8TasksDirectory, type V8BenchTask, type V8CaseReport } from "./bench";
function argument(name: string): string | null { const i = process.argv.indexOf(name); if (i < 0) return null; const v = process.argv[i+1]; if (!v || v.startsWith("--")) throw new Error(`${name} requires a value`); return v; }
const pad = (v: string, w: number) => v.padEnd(w).slice(0, w);
function resultCell(r: V8CaseReport, id: string) { return r.results.find((x) => x.id === id)?.status ?? "—"; }
function printMatrix(reports: V8CaseReport[]) {
  const header = [pad("task",20),pad("submission",32),pad("status",8),pad("cover",7),pad("inst",5),pad("frames",8),pad("connect",8),pad("block",7),pad("bearing",7),pad("balance",7),pad("guide",7),pad("bore",7),pad("head",7),pad("collide",8),pad("source",7),pad("err",9)].join(" ");
  console.log(header); console.log("-".repeat(header.length));
  for (const r of reports) console.log([pad(r.taskId,20),pad(r.submission,32),pad(r.status,8),pad(r.layers.coverage.ratio===null?"—":`${r.layers.coverage.passed}/${r.layers.coverage.observed}`,7),pad(String(r.measurements.parts.length),5),pad(resultCell(r,"measured-joint-frames"),8),pad(resultCell(r,"part-connectivity"),8),pad(resultCell(r,"frame-connectivity"),7),pad(resultCell(r,"bearing-fit"),7),pad(resultCell(r,"counterweight-balance"),7),pad(resultCell(r,"guide-clearance"),7),pad(resultCell(r,"bore-clearance"),7),pad(resultCell(r,"head-clearance"),7),pad(resultCell(r,"sampled-motion"),8),pad(resultCell(r,"source-motion"),7),pad(r.measurements.maxPositionErrorMm?.toFixed(4)??"—",9)].join(" "));
}
async function main() {
  const taskFilter = argument("--task"), subFilter = argument("--submission");
  const jsonPath = argument("--json") ?? path.join(import.meta.dir, "report.json");
  const selfCheck = process.argv.includes("--self-check");
  const tasks = await loadV8Tasks(); const selected = taskFilter ? tasks.filter((t) => t.id === taskFilter) : tasks;
  if (!selected.length) throw new Error(`No V8 task matches "${taskFilter}"`);
  const work: Array<{task:V8BenchTask;submission:Awaited<ReturnType<typeof loadV8Submissions>>[number]}> = [];
  for (const task of selected) { const submissions = await loadV8Submissions(task.id); if (!submissions.length) throw new Error(`Task ${task.id} has no submissions under ${v8SubmissionsDirectory()}/`); for (const submission of submissions) { if (subFilter && submission.id !== subFilter) continue; work.push({task,submission}); } }
  if (!work.length) throw new Error(`No submission matches "${subFilter}"`);
  const reports: V8CaseReport[] = [];
  for (const item of work) reports.push(await scoreV8Submission(item.task, item.submission));
  printMatrix(reports);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify({ schemaVersion: "v8-bench.report.v1", createdAt: new Date().toISOString(), tasksDirectory: path.relative(process.cwd(), v8TasksDirectory()), summary: { cases: reports.length, passed: reports.filter((r)=>r.status==="PASS").length, failed: reports.filter((r)=>r.status==="FAIL"||r.status==="ERROR").length, notRun: reports.filter((r)=>r.status==="NOT_RUN").length }, reports }, null, 2)}\n`);
  if (!selfCheck) return;
  const failures: string[] = [];
  for (const r of reports) { if (r.expected==="pass" && r.status!=="PASS") failures.push(`${r.taskId}/${r.submission}: expected PASS, observed ${r.status}`); if (r.expected==="fail" && r.status==="PASS") failures.push(`${r.taskId}/${r.submission}: adversarial passed`); }
  if (failures.length) { console.error(`SELF-CHECK FAILED:\n${failures.join("\n")}`); process.exitCode = 1; return; }
  console.log(`\nSELF-CHECK OK: ${reports.filter((r)=>r.expected==="pass").length} reference(s) pass, ${reports.filter((r)=>r.expected==="fail").length} adversarial submission(s) rejected.`);
}
await main();
