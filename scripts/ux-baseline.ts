#!/usr/bin/env bun

// ---------------------------------------------------------------------------
// UX baseline
//
// Every number the improvement loop depends on, from one command, on one
// database. Before this existed the baseline was dug out of SQLite by hand each
// round, which meant each round's conclusions rested on whatever ad-hoc query
// happened to be written that day.
//
// Read the caveats it prints. This product is local-first with no accounts and
// collects nothing, so these numbers come from whatever this database happens to
// contain — they are a record of what happened here, not a measurement of users.
//
// Usage:  bun run ux:baseline [--stale-hours 2]
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import {
  summarizeJobOutcomes,
  toJobOutcomeEvent,
} from "@/lib/outcome/job-outcome";

// A run ends by reaching one of these. Anywhere else means it was still going.
const IN_FLIGHT_STATES = new Set([
  "NEW",
  "SCAD_GENERATED",
  "RENDERED",
  "VALIDATED",
  "DEBUGGING",
  "REPAIRING",
]);
const FAILED_STATES = new Set([
  "GEOMETRY_FAILED",
  "RENDER_FAILED",
  "VALIDATION_FAILED",
]);

const staleHours = (() => {
  const flag = process.argv.indexOf("--stale-hours");
  const raw = flag > -1 ? Number(process.argv[flag + 1]) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
})();

const MS_PER_HOUR = 3_600_000;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? null;
}

function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function hours(ms: number): string {
  return `${(ms / MS_PER_HOUR).toFixed(1)}h`;
}

const jobs = await db.job.findMany({
  include: { outcomes: { orderBy: { createdAt: "asc" } } },
  orderBy: { createdAt: "asc" },
});

const now = Date.now();
const line = (label: string, value: string, indent = "  ") =>
  console.log(`${indent}${label.padEnd(34)}${value}`);

console.log(`\nUX baseline — ${jobs.length} job(s), ${new Date(now).toISOString()}`);
console.log(`staleness threshold: ${staleHours}h`);

// --- 1. state distribution -------------------------------------------------
const byState = new Map<string, number>();
for (const job of jobs) byState.set(job.state, (byState.get(job.state) ?? 0) + 1);
console.log("\nWhere jobs are right now");
for (const [state, count] of [...byState].sort((a, b) => b[1] - a[1])) {
  line(state, String(count));
}

// --- 2. delivery and acceptance -------------------------------------------
const delivered = jobs.filter((job) => job.state === "DELIVERED");
const summaries = new Map(
  jobs.map((job) => [
    job.id,
    summarizeJobOutcomes(job.outcomes.map(toJobOutcomeEvent)),
  ]),
);
const accepted = delivered.filter((job) => summaries.get(job.id)?.taskSucceeded);
const rejected = delivered.filter(
  (job) => summaries.get(job.id)?.latestDecision?.kind === "rejected",
);
const undecided = delivered.filter(
  (job) => !summaries.get(job.id)?.latestDecision,
);

console.log("\nDelivery and acceptance (newest decision wins, edits/exports do not count)");
line("delivered", String(delivered.length));
line("accepted", String(accepted.length));
line("rejected", String(rejected.length));
line("delivered, no verdict yet", String(undecided.length));
line(
  "task success rate",
  delivered.length === 0
    ? "— (nothing delivered yet)"
    : `${((accepted.length / delivered.length) * 100).toFixed(0)}% of ${delivered.length}`,
);
line(
  "verdict coverage",
  delivered.length === 0
    ? "—"
    : `${(((delivered.length - undecided.length) / delivered.length) * 100).toFixed(0)}%`,
);

// --- 3. wait time ----------------------------------------------------------
// `latencyMs` is wall-clock time for ONE run, written once at the end of it.
// It deliberately excludes time a job spent parked in human review.
const finishedLatencies = jobs
  .filter((job) => job.latencyMs !== null && !IN_FLIGHT_STATES.has(job.state))
  .map((job) => job.latencyMs as number)
  .sort((a, b) => a - b);

console.log("\nWait time per run (wall clock, this run only)");
line("runs measured", String(finishedLatencies.length));
line("p50", seconds(percentile(finishedLatencies, 0.5)));
line("p90", seconds(percentile(finishedLatencies, 0.9)));
line("max", seconds(percentile(finishedLatencies, 1)));

const timeToDelivery = jobs
  .filter((job) => job.completedAt !== null)
  .map((job) => job.completedAt!.getTime() - job.createdAt.getTime())
  .sort((a, b) => a - b);
line("total time to delivery p50", seconds(percentile(timeToDelivery, 0.5)));

// --- 4. model cost ---------------------------------------------------------
const callCounts = jobs.map((job) => job.llmCallCount).sort((a, b) => a - b);
console.log("\nModel calls per job (cumulative across every run)");
line("p50", String(percentile(callCounts, 0.5) ?? "—"));
line("p90", String(percentile(callCounts, 0.9) ?? "—"));
line("max", String(percentile(callCounts, 1) ?? "—"));

// --- 5. the signal that did not exist before -------------------------------
// A run ends by writing `latencyMs` in its `finally` block. So a job sitting in
// an in-flight state with no `latencyMs` is a run that never got to finish.
const inFlight = jobs.filter((job) => IN_FLIGHT_STATES.has(job.state));
const interrupted = inFlight.filter((job) => job.latencyMs === null);
const stale = inFlight.filter(
  (job) => now - Math.max(job.updatedAt.getTime(), job.createdAt.getTime()) > staleHours * MS_PER_HOUR,
);

console.log("\nRuns that never finished (the abandonment signal)");
console.log(
  "  A run ends by writing latencyMs. In-flight with no latencyMs = it never got there.",
);
line("in flight now", String(inFlight.length));
line("never finished", String(interrupted.length), "    ");
line(`untouched for > ${staleHours}h`, String(stale.length), "    ");

for (const job of stale.slice(0, 10)) {
  const age = now - Math.max(job.updatedAt.getTime(), job.createdAt.getTime());
  console.log(
    `    ${job.id.slice(0, 8)}  ${job.state.padEnd(14)} idle ${hours(age).padStart(6)}  ` +
      `"${job.inputRequest.slice(0, 48)}"`,
  );
}

// --- 6. failures -----------------------------------------------------------
const failed = jobs.filter((job) => FAILED_STATES.has(job.state));
console.log("\nFailures");
line("failed states", String(failed.length));
line("parked in human review", String(jobs.filter((j) => j.state === "HUMAN_REVIEW").length));
line("cancelled", String(jobs.filter((j) => j.state === "CANCELLED").length));

// --- caveats ---------------------------------------------------------------
console.log("\nWhat these numbers are not");
console.log(
  [
    "  - They describe this database only. The product collects nothing, so there is no",
    "    second source to compare against and no way to know if this usage is typical.",
    "  - 'Never finished' cannot tell a closed tab from a server restart. Both look the",
    "    same in the data, and nothing in the product currently tries to distinguish them.",
    "  - A batch migration can rewrite `updatedAt` for every row it touches, which makes",
    "    any row it touched look freshly used. Idle-time figures are only as good as that.",
    "  - latencyMs and llmCallCount changed meaning on 2026-10-26. Run",
    "    `bun run metrics:reset -- --yes` once per database before trusting either.",
    latencyCheck() ?? "",
  ]
    .filter(Boolean)
    .join("\n"),
);

function latencyCheck(): string | null {
  const poisoned = jobs.filter(
    (job) => job.latencyMs === null && !IN_FLIGHT_STATES.has(job.state) && job.completedAt !== null,
  );
  return poisoned.length > 0
    ? `  - ${poisoned.length} finished job(s) have no latencyMs. They predate the metrics\n` +
        `    fix; exclude them from any average.`
    : null;
}

await db.$disconnect();
