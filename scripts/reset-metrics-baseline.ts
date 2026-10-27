#!/usr/bin/env bun

// ---------------------------------------------------------------------------
// Metric baseline cut-over
//
// `Job.latencyMs` and `Job.llmCallCount` changed meaning on 2026-10-26:
//   - `latencyMs` used to stop the clock inside the SCAD_GENERATED transition,
//     so it measured roughly the first third of the wait. A job that took 296 s
//     of wall clock recorded 26.6 s. It now covers the whole run.
//   - `llmCallCount` used to be one skill run's own counter, reassigned on every
//     run and blind to intake, research and repair. It now accumulates every
//     model call across every run of a job.
//
// Both changes push the number in one direction only — a new value is always
// greater than or equal to the old one would have been. That is exactly what
// makes a mixed column dangerous: the two kinds of row are indistinguishable in
// a table, so an average over them is a number that means nothing.
//
// This script empties both columns so that afterwards, any non-null `latencyMs`
// is provably new-semantics. It is idempotent — a second run changes nothing.
//
// Usage:  bun run metrics:reset -- --yes
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";

const confirmed = process.argv.includes("--yes");

function describeDatabase(): string {
  const url = process.env.DATABASE_URL ?? "(DATABASE_URL unset)";
  // Never print credentials that may be riding along in the URL.
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

console.log(`Database: ${describeDatabase()}`);

if (!confirmed) {
  const stale = await db.job.count({
    where: {
      OR: [{ latencyMs: { not: null } }, { llmCallCount: { not: 0 } }],
    },
  });
  console.log(
    `Dry run: ${stale} job(s) still carry old-semantics metrics.\n` +
      `Re-run with --yes to clear them.`
  );
  await db.$disconnect();
  process.exit(0);
}

const cleared = await db.job.updateMany({
  data: { latencyMs: null, llmCallCount: 0 },
});

console.log(
  `Cleared metric baseline for ${cleared.count} job(s). ` +
    `Any non-null latencyMs from now on is new-semantics.`
);

await db.$disconnect();
