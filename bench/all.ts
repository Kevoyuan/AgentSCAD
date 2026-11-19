#!/usr/bin/env bun
/**
 * Runs every public bench family's self-check and writes one aggregate matrix.
 * This is a real native-render gate: it does not merge stale reports silently,
 * because each family runner rewrites its report before the matrix reads it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const FAMILIES = [
  { family: "assembly", script: "bench/assembly/run.ts", report: "bench/assembly/report.json" },
  { family: "gear", script: "bench/gear/run.ts", report: "bench/gear/report.json" },
  { family: "slider", script: "bench/slider/run.ts", report: "bench/slider/report.json" },
  { family: "l4", script: "bench/l4/run.ts", report: "bench/l4/report.json" },
  { family: "twin", script: "bench/twin/run.ts", report: "bench/twin/report.json" },
  { family: "vtwin", script: "bench/vtwin/run.ts", report: "bench/vtwin/report.json" },
  { family: "declaration", script: "bench/declaration/run.ts", report: "bench/declaration/report.json" },
  { family: "v8", script: "bench/v8/run.ts", report: "bench/v8/report.json" },
  { family: "planetary", script: "bench/planetary/run.ts", report: "bench/planetary/report.json" },
] as const;

export interface FamilyRow {
  family: string;
  exitCode: number;
  selfCheck: boolean;
  cases: number;
  references: number;
  adversarial: number;
  unscored: number;
  passed: number;
  failed: number;
  notRun: number;
  layers: { passed: number; observed: number };
  report: string;
  lastLine: string;
}

interface ReportRow {
  expected?: string;
  status?: string;
  layers?: { coverage?: { passed?: number; observed?: number } };
}
interface ReportFile { cases?: ReportRow[]; reports?: ReportRow[] }

export function summarizeReport(family: string, reportPath: string, exitCode: number, stdout: string, report: ReportFile): FamilyRow {
  const rows = report.cases ?? report.reports ?? [];
  const references = rows.filter((row) => row.expected === "pass").length;
  const adversarial = rows.filter((row) => row.expected === "fail").length;
  const unscored = rows.length - references - adversarial;
  const layers = rows.reduce((sum, row) => ({ passed: sum.passed + (row.layers?.coverage?.passed ?? 0), observed: sum.observed + (row.layers?.coverage?.observed ?? 0) }), { passed: 0, observed: 0 });
  const selfCheckLine = stdout.split("\n").find((line) => line.includes("SELF-CHECK OK")) ?? stdout.trim().split("\n").at(-1) ?? "";
  return {
    family, exitCode, selfCheck: exitCode === 0 && Boolean(selfCheckLine.includes("SELF-CHECK OK")),
    cases: rows.length, references, adversarial, unscored,
    passed: rows.filter((row) => row.status === "PASS").length,
    failed: rows.filter((row) => row.status === "FAIL" || row.status === "ERROR").length,
    notRun: rows.filter((row) => row.status === "NOT_RUN").length,
    layers, report: path.relative(process.cwd(), reportPath), lastLine: selfCheckLine.trim(),
  };
}

export function formatMatrix(rows: FamilyRow[]): string {
  const pad = (value: string, width: number) => value.padEnd(width).slice(0, width);
  const header = [pad("family", 12), pad("self-check", 10), pad("cases", 6), pad("refs", 5), pad("adv", 5), pad("unscored", 9), pad("pass", 5), pad("fail", 5), pad("not-run", 8), pad("layers", 9)].join(" ");
  const lines = [header, "-".repeat(header.length)];
  for (const row of rows) {
    lines.push([pad(row.family, 12), pad(row.selfCheck ? "OK" : "FAIL", 10), pad(String(row.cases), 6), pad(String(row.references), 5), pad(String(row.adversarial), 5), pad(String(row.unscored), 9), pad(String(row.passed), 5), pad(String(row.failed), 5), pad(String(row.notRun), 8), pad(`${row.layers.passed}/${row.layers.observed}`, 9)].join(" "));
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const bun = Bun.which("bun") ?? process.execPath;
  const rows: FamilyRow[] = [];
  for (const item of FAMILIES) {
    const started = performance.now();
    const proc = Bun.spawn([bun, "run", item.script, "--self-check"], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    let report: ReportFile = {};
    try { report = JSON.parse(await readFile(path.join(process.cwd(), item.report), "utf8")) as ReportFile; } catch { /* summary below records the failure */ }
    const row = summarizeReport(item.family, path.join(process.cwd(), item.report), exitCode, stdout, report);
    rows.push(row);
    console.log(`[${row.selfCheck ? "ok" : "FAIL"}] ${item.family} (${Math.round(performance.now() - started)} ms) — ${row.lastLine}`);
    if (!row.selfCheck) {
      const tail = (stderr || stdout).trim().split("\n").slice(-8).join("\n");
      if (tail) console.error(tail);
    }
  }
  console.log(`\n${formatMatrix(rows)}`);
  const failures = rows.filter((row) => !row.selfCheck);
  const overall = failures.length === 0 ? "PASS" : "FAIL";
  const matrixPath = path.join(process.cwd(), "bench", "matrix.json");
  await mkdir(path.dirname(matrixPath), { recursive: true });
  await writeFile(matrixPath, `${JSON.stringify({ schemaVersion: "bench-matrix.v1", generatedAt: new Date().toISOString(), overall, families: rows, failures: failures.map((row) => row.family) }, null, 2)}\n`);
  console.log(`\noverall: ${overall}${failures.length ? ` (${failures.map((row) => row.family).join(", ")})` : ""}`);
  console.log(`matrix: ${path.relative(process.cwd(), matrixPath)}`);
  if (failures.length > 0) process.exitCode = 1;
}
if (import.meta.main) await main();
