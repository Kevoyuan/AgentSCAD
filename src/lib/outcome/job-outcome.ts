import { db } from "@/lib/db";

/**
 * Job outcome ledger.
 *
 * The pipeline state machine answers "where is the build?". This ledger answers the
 * separate question "what did the user actually do with the result?". Keeping them
 * apart is the whole point: `DELIVERED` proves artifacts exist, not that the part was
 * accepted, and a repair round is not a failure the user reported.
 *
 * Events are append-only. Nothing here writes to memory or to prompts, so a wrong or
 * noisy event can never contaminate generation.
 */

export const JOB_OUTCOME_KINDS = [
  "accepted",
  "rejected",
  "user_edited",
  "exported",
] as const;

export type JobOutcomeKind = (typeof JOB_OUTCOME_KINDS)[number];

export const JOB_OUTCOME_SOURCES = ["user", "system"] as const;
export type JobOutcomeSource = (typeof JOB_OUTCOME_SOURCES)[number];

/** Decisions are the outcomes that answer "did this task succeed?". */
export const JOB_OUTCOME_DECISIONS: readonly JobOutcomeKind[] = ["accepted", "rejected"];

export const JOB_OUTCOME_MAX_DETAIL_LENGTH = 500;
export const JOB_OUTCOME_DEFAULT_LIMIT = 50;
export const JOB_OUTCOME_MAX_LIMIT = 500;

export function isJobOutcomeKind(value: unknown): value is JobOutcomeKind {
  return typeof value === "string" && (JOB_OUTCOME_KINDS as readonly string[]).includes(value);
}

export function isJobOutcomeSource(value: unknown): value is JobOutcomeSource {
  return typeof value === "string" && (JOB_OUTCOME_SOURCES as readonly string[]).includes(value);
}

/** Bound and normalize free-text detail so one event can never bloat the table. */
export function sanitizeOutcomeDetail(detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  if (!text) return null;
  return text.length > JOB_OUTCOME_MAX_DETAIL_LENGTH
    ? text.slice(0, JOB_OUTCOME_MAX_DETAIL_LENGTH)
    : text;
}

export interface JobOutcomeEvent {
  id: string;
  jobId: string;
  kind: JobOutcomeKind;
  source: JobOutcomeSource;
  detail: string | null;
  createdAt: Date;
}

export interface RecordJobOutcomeInput {
  jobId: string;
  kind: JobOutcomeKind;
  source?: JobOutcomeSource;
  detail?: unknown;
}

export class JobOutcomeValidationError extends Error {}

/**
 * Record an outcome event.
 *
 * Throws on invalid input so the HTTP route can answer 400. Automatic call sites inside
 * request paths should use `recordJobOutcomeSafe` instead.
 */
export async function recordJobOutcome(
  input: RecordJobOutcomeInput,
): Promise<JobOutcomeEvent> {
  if (!input?.jobId || typeof input.jobId !== "string") {
    throw new JobOutcomeValidationError("jobId is required");
  }
  if (!isJobOutcomeKind(input.kind)) {
    throw new JobOutcomeValidationError(
      `Unknown outcome kind. Expected one of: ${JOB_OUTCOME_KINDS.join(", ")}`,
    );
  }
  const source = input.source ?? "user";
  if (!isJobOutcomeSource(source)) {
    throw new JobOutcomeValidationError(
      `Unknown outcome source. Expected one of: ${JOB_OUTCOME_SOURCES.join(", ")}`,
    );
  }

  const created = await db.jobOutcome.create({
    data: {
      jobId: input.jobId,
      kind: input.kind,
      source,
      detail: sanitizeOutcomeDetail(input.detail),
    },
  });

  return {
    id: created.id,
    jobId: created.jobId,
    kind: created.kind as JobOutcomeKind,
    source: created.source as JobOutcomeSource,
    detail: created.detail,
    createdAt: created.createdAt,
  };
}

/**
 * Best-effort variant for automatic instrumentation.
 *
 * Losing a signal is acceptable; failing a user's render or download because the ledger
 * write failed is not. Returns null instead of throwing.
 */
export async function recordJobOutcomeSafe(
  input: RecordJobOutcomeInput,
): Promise<JobOutcomeEvent | null> {
  try {
    return await recordJobOutcome(input);
  } catch (error) {
    console.warn("Failed to record job outcome", {
      jobId: input?.jobId,
      kind: input?.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function clampOutcomeLimit(limit: unknown): number {
  const parsed = typeof limit === "number" ? limit : Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return JOB_OUTCOME_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), JOB_OUTCOME_MAX_LIMIT);
}

export async function listJobOutcomes(
  jobId: string,
  limit: number = JOB_OUTCOME_DEFAULT_LIMIT,
): Promise<JobOutcomeEvent[]> {
  const rows = await db.jobOutcome.findMany({
    where: { jobId },
    // Newest first so the limit keeps the events that decide the summary, then restore
    // chronological order for display.
    orderBy: { createdAt: "desc" },
    take: clampOutcomeLimit(limit),
  });

  return rows.reverse().map((row) => ({
    id: row.id,
    jobId: row.jobId,
    kind: row.kind as JobOutcomeKind,
    source: row.source as JobOutcomeSource,
    detail: row.detail,
    createdAt: row.createdAt,
  }));
}

export interface JobOutcomeSummary {
  total: number;
  counts: Record<JobOutcomeKind, number>;
  /** Most recent decision event, if the user has made one. */
  latestDecision: { kind: JobOutcomeKind; createdAt: Date } | null;
  /**
   * True only when the most recent decision is `accepted`.
   *
   * Edits and exports are process signals, not proof of success: a user can export a
   * part they are unhappy with, and an edit means the first result was not final. This
   * definition is deliberately strict so the number stays honest.
   */
  taskSucceeded: boolean;
}

export function summarizeJobOutcomes(
  events: Array<Pick<JobOutcomeEvent, "kind" | "createdAt">>,
): JobOutcomeSummary {
  const counts = JOB_OUTCOME_KINDS.reduce(
    (acc, kind) => ({ ...acc, [kind]: 0 }),
    {} as Record<JobOutcomeKind, number>,
  );

  let latestDecision: JobOutcomeSummary["latestDecision"] = null;

  for (const event of events) {
    if (isJobOutcomeKind(event.kind)) counts[event.kind] += 1;
    if (!JOB_OUTCOME_DECISIONS.includes(event.kind)) continue;
    if (!latestDecision || event.createdAt >= latestDecision.createdAt) {
      latestDecision = { kind: event.kind, createdAt: event.createdAt };
    }
  }

  return {
    total: events.length,
    counts,
    latestDecision,
    taskSucceeded: latestDecision?.kind === "accepted",
  };
}
