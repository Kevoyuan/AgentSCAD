#!/usr/bin/env bun
/**
 * Scores every recorded trial report on the layer model and prints where the
 * product actually stands.
 *
 * Usage:
 *   bun bench/ladder-report.ts                    # .agentscad/experiments
 *   bun bench/ladder-report.ts <dir|report.json>  # explicit inputs
 *   bun bench/ladder-report.ts --json out.json
 *
 * This reads evidence that was already produced. It never calls a model and
 * never renders geometry, so it is free to run on every batch.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { buildLadderReport, scoreRun, type ScoredRun, type TrialReportInput } from "./ladder-score";
import { LAYERS } from "./layers";

const DEFAULT_ROOT = path.join(process.cwd(), ".agentscad", "experiments");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function collectReports(root: string): Promise<string[]> {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) throw new Error(`找不到路径：${root}`);
  if (stat.isFile()) return [root];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        // Trial reports live one level down, next to their artifacts.
        const direct = path.join(entryPath, "report.json");
        const exists = await fs.stat(direct).catch(() => null);
        if (exists?.isFile()) return [direct];
        return collectReports(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [] : [];
    }),
  );
  return nested.flat().sort();
}

const pad = (value: string, width: number) => value.padEnd(width).slice(0, width);
const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const fixed = (value: number | null) => (value === null ? "—" : value.toFixed(3));

async function main(): Promise<void> {
  const explicitOut = argument("--json");
  const consumed = new Set<number>();
  for (const flag of ["--json"]) {
    const index = process.argv.indexOf(flag);
    if (index >= 0) consumed.add(index).add(index + 1);
  }
  const roots = process.argv.slice(2).filter((value, offset) => !value.startsWith("--") && !consumed.has(offset + 2));
  const root = roots.length > 0 ? path.resolve(roots[0]) : DEFAULT_ROOT;

  const files = await collectReports(root);
  if (files.length === 0) throw new Error(`在 ${root} 下没有找到 report.json`);

  const runs: ScoredRun[] = [];
  let skipped = 0;
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    let parsed: TrialReportInput;
    try {
      parsed = JSON.parse(raw) as TrialReportInput;
    } catch (error) {
      throw new Error(`${path.relative(process.cwd(), file)}: JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    // The experiment tree also holds geometry reports that never called a
    // model. They are not trial reports; counting them would pad the batch
    // total with files that can never carry a candidate.
    if (!Array.isArray(parsed.tasks)) {
      skipped += 1;
      continue;
    }
    runs.push(scoreRun(path.basename(path.dirname(file)), path.relative(process.cwd(), file), parsed));
  }
  if (runs.length === 0) throw new Error(`在 ${root} 下的 ${files.length} 个 JSON 里没有试验报告（缺少 tasks 数组）`);

  const report = buildLadderReport(runs);

  // Candidate table: highest coverage first, because the question is always
  // "what is the best thing this system has produced".
  const candidates = runs
    .flatMap((run) => run.tasks.map((task) => ({ run, task })))
    .filter(({ task }) => task.coverage.observed > 0)
    .sort((a, b) => (b.task.coverage.ratio ?? 0) - (a.task.coverage.ratio ?? 0));

  console.log(
    `读取 ${runs.length} 个试验批次 / ${report.aggregate.candidates} 个候选（${report.aggregate.candidatesWithEvidence} 个有证据）${skipped > 0 ? `，跳过 ${skipped} 个非试验报告` : ""}\n`,
  );

  const header = `${pad("候选", 30)}${pad("批次", 32)}${pad("覆盖", 8)}${pad("gate", 6)}${pad("调用", 6)}${pad("每调用", 8)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const { run, task } of candidates.slice(0, 20)) {
    console.log(
      `${pad(task.id, 30)}${pad(run.runId.replace("paid-deepseek-assembly-", "…"), 32)}${pad(fixed(task.coverage.ratio), 8)}${pad(task.gate === true ? "PASS" : task.gate === false ? "fail" : "—", 6)}${pad(String(task.calls), 6)}${pad(fixed(task.coveragePerCall), 8)}`,
    );
  }
  if (candidates.length > 20) console.log(`… 其余 ${candidates.length - 20} 个候选省略`);

  console.log(`\n层聚合（${report.aggregate.candidatesWithEvidence} 个有证据的候选）`);
  const layerHeader = `${pad("层", 18)}${pad("通过", 6)}${pad("失败", 6)}${pad("错误", 6)}${pad("未跑", 6)}${pad("缺证", 6)}${pad("通过率", 10)}${pad("缺口类型", 14)}修什么`;
  console.log(layerHeader);
  console.log("-".repeat(layerHeader.length + 10));
  for (const row of report.aggregate.layers) {
    const spec = LAYERS.find((layer) => layer.id === row.layer);
    const label = row.diagnosis === "measurement-gap" ? "缺检查"
      : row.diagnosis === "undetermined" ? "待查 ERROR"
      : row.diagnosis === "capability-gap" ? "做不出来"
      : row.diagnosis === "healthy" ? "正常" : "未观测";
    console.log(
      `${pad(row.layer, 18)}${pad(String(row.pass), 6)}${pad(String(row.fail), 6)}${pad(String(row.error), 6)}${pad(String(row.notRun), 6)}${pad(String(row.absent), 6)}${pad(pct(row.observedPassRate), 10)}${pad(label, 14)}${spec?.subsystem ?? ""}`,
    );
  }

  // History: shape only. Task sets and verifiers changed across these batches,
  // so an upward slope is a signal to investigate, never a success claim.
  const byDay = new Map<string, { runs: number; ratios: number[] }>();
  for (const run of runs) {
    if (!run.startedAt) continue;
    const day = run.startedAt.slice(0, 10);
    const bucket = byDay.get(day) ?? { runs: 0, ratios: [] };
    bucket.runs += 1;
    for (const task of run.tasks) if (task.coverage.ratio !== null) bucket.ratios.push(task.coverage.ratio);
    byDay.set(day, bucket);
  }
  if (byDay.size > 0) {
    console.log("\n按时间（只读形状，不可跨版本比高低）");
    for (const [day, bucket] of [...byDay.entries()].sort()) {
      const mean = bucket.ratios.length === 0 ? null : bucket.ratios.reduce((sum, value) => sum + value, 0) / bucket.ratios.length;
      const best = bucket.ratios.length === 0 ? null : Math.max(...bucket.ratios);
      console.log(`  ${day}  ${String(bucket.runs).padStart(2)} 批  均值 ${pct(mean)}  最好 ${pct(best)}`);
    }
  }

  console.log(
    `\n汇总：候选 ${report.aggregate.candidates}，有证据 ${report.aggregate.candidatesWithEvidence}，gate 通过 ${report.aggregate.gatePassed}，平均覆盖 ${pct(report.aggregate.meanCoverage)}`,
  );
  for (const warning of report.warnings) console.log(`注意：${warning}`);

  const outPath = explicitOut ?? path.join(import.meta.dir, "ladder-report.json");
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n报告：${path.relative(process.cwd(), outPath)}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
