import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeUserEdits, writeLearnedPatterns } from "@/lib/improvement-analyzer";
import { authenticateBearer } from "@/lib/auth";
import {
  checkPublicArtifact,
  deleteSupersededJobArtifacts,
} from "@/lib/tools/artifact-store";

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function authenticate(request: NextRequest): boolean {
  return authenticateBearer(request, process.env.CRON_SECRET);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAILED_STATES = ["RENDER_FAILED", "GEOMETRY_FAILED", "VALIDATION_FAILED"];
const MAX_RETRIES_PER_RUN = 5;

// ---------------------------------------------------------------------------
// retry-failed action
// ---------------------------------------------------------------------------

async function retryFailed(): Promise<{
  retried: number;
  skipped: number;
  errors: string[];
}> {
  const failedJobs = await db.job.findMany({
    where: {
      state: { in: FAILED_STATES },
      retryCount: { lt: db.job.fields.maxRetries },
    },
    orderBy: [{ createdAt: "asc" }],
    take: MAX_RETRIES_PER_RUN,
  });

  let retried = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const job of failedJobs) {
    try {
      // Use a transaction to atomically increment retryCount and reset state
      // This ensures idempotency — if two cron runs overlap, only one will
      // successfully update each job due to the state check.
      const updated = await db.$transaction(async (tx) => {
        // Re-check state inside transaction to avoid race conditions
        const current = await tx.job.findUnique({ where: { id: job.id } });
        if (!current || !FAILED_STATES.includes(current.state)) {
          return null; // Already retried by another process
        }
        if (current.retryCount >= current.maxRetries) {
          return null; // Max retries reached
        }

        return tx.job.update({
          where: { id: job.id },
          data: {
            retryCount: current.retryCount + 1,
            state: "NEW",
            stlPath: null,
            pngPath: null,
            renderLog: null,
            validationResults: null,
            executionLogs: JSON.stringify([
              {
                timestamp: new Date().toISOString(),
                event: "CRON_RETRY",
                message: `Auto-retry attempt ${current.retryCount + 1}/${current.maxRetries} (previous state: ${current.state})`,
              },
            ]),
          },
        });
      });

      if (!updated) {
        skipped++;
        continue;
      }

      retried++;

      // Kick off processing asynchronously — fire and forget.
      // We use fetch to our own endpoint so the cron route stays lightweight.
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      fetch(`${baseUrl}/api/jobs/${job.id}/process`, { method: "POST" }).catch(
        (err) => {
          console.error(
            `Cron: failed to kick off processing for job ${job.id}:`,
            err
          );
        }
      );
    } catch (err) {
      const msg = `Job ${job.id}: ${err instanceof Error ? err.message : "unknown error"}`;
      errors.push(msg);
      console.error("Cron retry-failed error:", msg);
    }
  }

  // Count remaining jobs that were skipped due to the limit
  const remaining = await db.job.count({
    where: {
      state: { in: FAILED_STATES },
      retryCount: { lt: db.job.fields.maxRetries },
    },
  });
  skipped += Math.max(0, remaining - (failedJobs.length - retried - errors.length));

  return { retried, skipped, errors };
}

// ---------------------------------------------------------------------------
// analyze-edits action — delegates to improvement-analyzer module
// ---------------------------------------------------------------------------

async function analyzeEdits(): Promise<{
  analyzed: number;
  patterns: number;
  families: string[];
}> {
  const patterns = await analyzeUserEdits(24);

  if (patterns.length === 0) {
    return { analyzed: 0, patterns: 0, families: [] };
  }

  // Persist the extracted patterns (merged with existing)
  await writeLearnedPatterns(patterns);

  // Compute response stats
  const familiesSeen = [...new Set(patterns.map((p) => p.family))];

  return {
    analyzed: patterns.length,
    patterns: patterns.length,
    families: familiesSeen,
  };
}

// ---------------------------------------------------------------------------
// warm-index action
// ---------------------------------------------------------------------------

async function warmIndex(): Promise<{
  warmed: number;
  missing: number;
  cached: number;
}> {
  let warmed = 0;
  let missing = 0;
  let cached = 0;
  let cursor: string | undefined;

  do {
    const deliveredJobs = await db.job.findMany({
      where: { state: "DELIVERED" },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        stlPath: true,
        pngPath: true,
        renderLog: true,
        parameterValues: true,
        validationResults: true,
        executionLogs: true,
      },
    });

    for (let index = 0; index < deliveredJobs.length; index += 5) {
      const batch = deliveredJobs.slice(index, index + 5);
      const results = await Promise.all(
        batch.map(async (job) => {
          try {
            const [stlStatus, pngStatus] = await Promise.all([
              checkPublicArtifact(job.stlPath, job.renderLog, "stl"),
              checkPublicArtifact(job.pngPath, job.renderLog, "png"),
            ]);
            const hasStl = stlStatus === "present";
            const hasPng = pngStatus === "present";

            let paramCount = 0;
            try {
              if (job.parameterValues) {
                const params = JSON.parse(job.parameterValues);
                paramCount = Object.keys(params).length;
              }
            } catch {
              // Ignore malformed legacy parameter data.
            }

            let validationScore = 0;
            try {
              if (job.validationResults) {
                const results = JSON.parse(job.validationResults);
                if (Array.isArray(results)) {
                  const passed = results.filter(
                    (result: { passed?: boolean }) => result.passed
                  ).length;
                  validationScore =
                    results.length > 0
                      ? Math.round((passed / results.length) * 100)
                      : 0;
                }
              }
            } catch {
              // Ignore malformed legacy validation data.
            }

            let logs: Array<{
              timestamp: string;
              event: string;
              message: string;
            }> = [];
            if (job.executionLogs) {
              try {
                logs = JSON.parse(job.executionLogs);
              } catch {
                logs = [];
              }
            }
            logs = logs.filter((log) => log.event !== "INDEX_WARMED");
            logs.push({
              timestamp: new Date().toISOString(),
              event: "INDEX_WARMED",
              message: `Cache warmed: ${paramCount} params, validation ${validationScore}%, STL=${stlStatus}, PNG=${pngStatus}`,
            });

            await db.job.update({
              where: { id: job.id },
              data: {
                stlPath: stlStatus === "missing" ? null : job.stlPath,
                pngPath: pngStatus === "missing" ? null : job.pngPath,
                executionLogs: JSON.stringify(logs),
              },
            });
            try {
              await deleteSupersededJobArtifacts(job.id, job.renderLog);
            } catch (cleanupError) {
              console.error(
                `Cron warm-index: failed to clean superseded artifacts for ${job.id}:`,
                cleanupError
              );
            }

            return {
              warmed: true,
              cached: hasStl && hasPng,
              missing: stlStatus === "missing" || pngStatus === "missing",
            };
          } catch (error) {
            console.error(`Cron warm-index: error for job ${job.id}:`, error);
            return { warmed: false, cached: false, missing: true };
          }
        })
      );

      warmed += results.filter((result) => result.warmed).length;
      cached += results.filter((result) => result.cached).length;
      missing += results.filter((result) => result.missing).length;
    }

    cursor = deliveredJobs.at(-1)?.id;
    if (deliveredJobs.length < 100) {
      cursor = undefined;
    }
  } while (cursor);

  return { warmed, missing, cached };
}

// ---------------------------------------------------------------------------
// POST /api/cron — Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Authenticate
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { action: 'retry-failed' | 'analyze-edits' | 'warm-index' | 'all' }" },
      { status: 400 }
    );
  }

  const action = body.action;
  if (!action) {
    return NextResponse.json(
      { error: "Missing 'action' field. Valid actions: retry-failed, analyze-edits, warm-index, all" },
      { status: 400 }
    );
  }

  const validActions = ["retry-failed", "analyze-edits", "warm-index", "all"];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action '${action}'. Valid actions: ${validActions.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const startTime = Date.now();
    const results: Record<string, unknown> = {};

    if (action === "retry-failed" || action === "all") {
      results["retry-failed"] = await retryFailed();
    }

    if (action === "analyze-edits" || action === "all") {
      results["analyze-edits"] = await analyzeEdits();
    }

    if (action === "warm-index" || action === "all") {
      results["warm-index"] = await warmIndex();
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      action,
      elapsed_ms: elapsed,
      results,
    });
  } catch (error) {
    console.error("Cron execution error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown cron error",
      },
      { status: 500 }
    );
  }
}
