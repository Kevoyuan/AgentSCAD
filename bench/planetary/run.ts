#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPlanetarySubmissions, loadPlanetaryTasks, planetarySubmissionsDirectory, planetaryTasksDirectory, scorePlanetarySubmission, type PlanetaryBenchTask, type PlanetaryCaseReport } from "./bench";
function argument(name: string): string | null { const i = process.argv.indexOf(name); if (i < 0) return null; const v = process.argv[i+1]; if (!v || v.startsWith("--")) throw new Error(`${name} requires a value`); return v; }
const pad = (v: string, w: number) => v.padEnd(w).slice(0, w);
function printMatrix(reports: PlanetaryCaseReport[]) {
  const header = [pad("task",22),pad("submission",32),pad("status",8),pad("cover",7),pad("parts",6),pad("sunRatio",9),pad("carrier",9),pad("planet",9)].join(" ");
  console.log(header); console.log("-".repeat(header.length));
  for (const r of reports) { const c=r.measurements.coupling; console.log([pad(r.taskId,22),pad(r.submission,32),pad(r.status,8),pad(r.layers.coverage.ratio===null?"—":`${r.layers.coverage.passed}/${r.layers.coverage.observed}`,7),pad(String(r.measurements.parts.length),6),pad(c?`${(c as any).sunRatio ?? "?"}`:"—",9),pad(r.measurements.maxCarrierResidualDeg?.toFixed(3)??"—",9),pad(r.measurements.maxPlanetResidualDeg?.toFixed(3)??"—",9)].join(" ")); }
}
async function main() {
  const taskFilter=argument("--task"), subFilter=argument("--submission"); const jsonPath=argument("--json")??path.join(import.meta.dir,"report.json"); const selfCheck=process.argv.includes("--self-check");
  const tasks=await loadPlanetaryTasks(); const selected=taskFilter?tasks.filter(t=>t.id===taskFilter):tasks; if(!selected.length)throw new Error(`No planetary task matches "${taskFilter}"`);
  const work:Array<{task:PlanetaryBenchTask;submission:Awaited<ReturnType<typeof loadPlanetarySubmissions>>[number]}>=[];
  for(const task of selected){const subs=await loadPlanetarySubmissions(task.id); if(!subs.length)throw new Error(`Task ${task.id} has no submissions under ${planetarySubmissionsDirectory()}/`); for(const submission of subs){if(subFilter&&submission.id!==subFilter)continue; work.push({task,submission});}}
  if(!work.length)throw new Error(`No submission matches "${subFilter}"`);
  const reports:PlanetaryCaseReport[]=[]; for(const item of work)reports.push(await scorePlanetarySubmission(item.task,item.submission));
  printMatrix(reports);
  await mkdir(path.dirname(jsonPath),{recursive:true});
  await writeFile(jsonPath,`${JSON.stringify({schemaVersion:"planetary-bench.report.v1",createdAt:new Date().toISOString(),tasksDirectory:path.relative(process.cwd(),planetaryTasksDirectory()),summary:{cases:reports.length,passed:reports.filter(r=>r.status==="PASS").length,failed:reports.filter(r=>r.status==="FAIL"||r.status==="ERROR").length,notRun:reports.filter(r=>r.status==="NOT_RUN").length},reports},null,2)}\n`);
  if(!selfCheck)return;
  const failures:string[]=[]; for(const r of reports){if(r.expected==="pass"&&r.status!=="PASS")failures.push(`${r.taskId}/${r.submission}: expected PASS, observed ${r.status}`); if(r.expected==="fail"&&r.status==="PASS")failures.push(`${r.taskId}/${r.submission}: adversarial passed`);}
  if(failures.length){console.error(`SELF-CHECK FAILED:\n${failures.join("\n")}`);process.exitCode=1;return;}
  console.log(`\nSELF-CHECK OK: ${reports.filter(r=>r.expected==="pass").length} reference(s) pass, ${reports.filter(r=>r.expected==="fail").length} adversarial submission(s) rejected.`);
}
await main();
