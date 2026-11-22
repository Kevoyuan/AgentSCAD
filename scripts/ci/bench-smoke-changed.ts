#!/usr/bin/env bun
/**
 * CI benchmark smoke runner.
 *
 * Runs only the benchmark families affected by a change, and for the expensive
 * families only a single reference submission. This is a regression smoke, not
 * a gate: the published matrix still comes from the full `bun run bench:all`.
 *
 * Base revision comes from BENCH_BASE_SHA (pull_request.base.sha or push
 * event.before). Empty base, all-zero SHA and BENCH_SMOKE_DRY_RUN=1 print the
 * plan without rendering.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

let base = (process.env.BENCH_BASE_SHA ?? "").trim();
const dryRun = process.env.BENCH_SMOKE_DRY_RUN === "1";
if (!base && !process.env.CI) {
  // Local convenience: compare the working tree's last commit against its parent.
  const parent = spawnSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" });
  if (parent.status === 0) base = parent.stdout.trim();
}
if (!base || /^0+$/.test(base)) {
  console.log("No base revision (schedule or initial push); skipping benchmark smoke. The scheduled full gate covers this.");
  process.exit(0);
}

const diff = spawnSync("git", ["diff", "--name-only", `${base}..HEAD`, "--", "bench", "src/lib/geometry", "src/lib/assembly", "src/lib/tools", "scripts/eval"], { encoding: "utf8" });
if (diff.status !== 0) {
  console.error(diff.stderr || "git diff failed");
  process.exit(diff.status ?? 1);
}
const files = diff.stdout.split("\n").map((line) => line.trim()).filter(Boolean);

const families = new Set<string>();
let shared = false;
const familyDir = /^bench\/([a-z0-9]+)\//;
for (const file of files) {
  const match = familyDir.exec(file);
  if (match && existsSync(`bench/${match[1]}/run.ts`)) families.add(match[1]);
  else if (file.startsWith("bench/") || file.startsWith("src/lib/geometry/") || file.startsWith("src/lib/assembly/") || file.startsWith("src/lib/tools/") || file.startsWith("scripts/eval/")) shared = true;
}
if (families.size === 0 && !shared) {
  console.log("No bench-relevant changes; benchmark smoke skipped.");
  process.exit(0);
}

const commands: string[][] = [];
if (shared) for (const family of ["assembly", "gear", "cam"]) commands.push(["bun", `bench/${family}/run.ts`, "--submission", "reference"]);
for (const family of [...families].sort()) {
  const taskArgs = family === "v8"
    ? ["--task", "v8-phase-8"]
    : family === "thread"
      ? ["--task", "threaded-fastener-1-5"]
      : family === "product"
        ? ["--task", "guided-product-8-28"]
        : [];
  commands.push(["bun", `bench/${family}/run.ts`, ...taskArgs, "--submission", "reference"]);
}

console.log(`Bench-relevant files: ${files.length}; families: ${[...families].sort().join(", ") || "none"}; shared: ${shared}`);
for (const command of commands) console.log(`SMOKE: ${command.join(" ")}`);
if (dryRun) {
  console.log("BENCH_SMOKE_DRY_RUN=1: plan only, no renders executed.");
  process.exit(0);
}
for (const [bin, ...args] of commands) {
  const result = spawnSync(bin, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`Benchmark smoke failed: ${bin} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}
console.log("Benchmark smoke passed.");
