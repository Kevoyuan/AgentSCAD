import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { JobOutcomeKind } from "../job-outcome";

let createdRows: Array<Record<string, unknown>> = [];
let findManyRows: Array<Record<string, unknown>> = [];
let createShouldFail = false;
let lastFindManyArgs: Record<string, unknown> | null = null;

beforeAll(() => {
  mock.module("@/lib/db", () => ({
    db: {
      jobOutcome: {
        create: mock(async ({ data }: { data: Record<string, unknown> }) => {
          if (createShouldFail) throw new Error("database is unavailable");
          const row = {
            id: `outcome-${createdRows.length + 1}`,
            createdAt: new Date("2026-09-18T10:00:00.000Z"),
            ...data,
          };
          createdRows.push(row);
          return row;
        }),
        findMany: mock(async (args: Record<string, unknown>) => {
          lastFindManyArgs = args;
          return findManyRows;
        }),
      },
    },
  }));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  createdRows = [];
  findManyRows = [];
  createShouldFail = false;
  lastFindManyArgs = null;
});

describe("job outcome ledger", () => {
  test("accepts only the declared vocabulary", async () => {
    const { isJobOutcomeKind, JOB_OUTCOME_KINDS } = await import("../job-outcome");
    expect(JOB_OUTCOME_KINDS).toEqual(["accepted", "rejected", "user_edited", "exported"]);
    for (const kind of JOB_OUTCOME_KINDS) expect(isJobOutcomeKind(kind)).toBe(true);
    expect(isJobOutcomeKind("delivered")).toBe(false);
    expect(isJobOutcomeKind("")).toBe(false);
    expect(isJobOutcomeKind(undefined)).toBe(false);
  });

  test("bounds detail so a single event cannot bloat the table", async () => {
    const { sanitizeOutcomeDetail, JOB_OUTCOME_MAX_DETAIL_LENGTH } = await import(
      "../job-outcome"
    );
    expect(sanitizeOutcomeDetail(null)).toBeNull();
    expect(sanitizeOutcomeDetail(undefined)).toBeNull();
    expect(sanitizeOutcomeDetail({ field: "parameters" })).toBe('{"field":"parameters"}');
    expect(sanitizeOutcomeDetail("x".repeat(900))?.length).toBe(JOB_OUTCOME_MAX_DETAIL_LENGTH);
  });

  test("rejects an unknown kind instead of writing it", async () => {
    const { recordJobOutcome, JobOutcomeValidationError } = await import("../job-outcome");
    await expect(
      recordJobOutcome({ jobId: "job-1", kind: "shipped" as JobOutcomeKind }),
    ).rejects.toBeInstanceOf(JobOutcomeValidationError);
    expect(createdRows).toHaveLength(0);
  });

  test("records a valid event with its source and bounded detail", async () => {
    const { recordJobOutcome } = await import("../job-outcome");
    const event = await recordJobOutcome({
      jobId: "job-1",
      kind: "accepted",
      detail: { note: "fits the shelf" },
    });
    expect(event).toMatchObject({
      id: "outcome-1",
      jobId: "job-1",
      kind: "accepted",
      source: "user",
      detail: '{"note":"fits the shelf"}',
    });
  });

  test("never lets a ledger failure break the caller", async () => {
    const { recordJobOutcomeSafe } = await import("../job-outcome");
    createShouldFail = true;
    const event = await recordJobOutcomeSafe({ jobId: "job-1", kind: "exported" });
    expect(event).toBeNull();
  });

  test("reads the newest events and returns them in chronological order", async () => {
    const { listJobOutcomes } = await import("../job-outcome");
    findManyRows = [
      {
        id: "outcome-2",
        jobId: "job-1",
        kind: "rejected",
        source: "user",
        detail: null,
        createdAt: new Date("2026-09-18T12:00:00.000Z"),
      },
      {
        id: "outcome-1",
        jobId: "job-1",
        kind: "accepted",
        source: "user",
        detail: null,
        createdAt: new Date("2026-09-18T10:00:00.000Z"),
      },
    ];

    const events = await listJobOutcomes("job-1");
    expect(events.map((event) => event.id)).toEqual(["outcome-1", "outcome-2"]);
    expect(lastFindManyArgs?.orderBy).toEqual({ createdAt: "desc" });
  });

  test("clamps the requested limit", async () => {
    const { clampOutcomeLimit, JOB_OUTCOME_DEFAULT_LIMIT, JOB_OUTCOME_MAX_LIMIT } = await import(
      "../job-outcome"
    );
    expect(clampOutcomeLimit(undefined)).toBe(JOB_OUTCOME_DEFAULT_LIMIT);
    expect(clampOutcomeLimit("0")).toBe(JOB_OUTCOME_DEFAULT_LIMIT);
    expect(clampOutcomeLimit("not-a-number")).toBe(JOB_OUTCOME_DEFAULT_LIMIT);
    expect(clampOutcomeLimit(10)).toBe(10);
    expect(clampOutcomeLimit(10_000)).toBe(JOB_OUTCOME_MAX_LIMIT);
  });
});

describe("outcome summary", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 18, 10, minutes));

  test("counts every kind and treats an empty ledger as not succeeded", async () => {
    const { summarizeJobOutcomes } = await import("../job-outcome");
    const summary = summarizeJobOutcomes([]);
    expect(summary.total).toBe(0);
    expect(summary.latestDecision).toBeNull();
    expect(summary.taskSucceeded).toBe(false);
    expect(summary.counts).toEqual({
      accepted: 0,
      rejected: 0,
      user_edited: 0,
      exported: 0,
    });
  });

  test("edits and exports are process signals, never success", async () => {
    const { summarizeJobOutcomes } = await import("../job-outcome");
    const summary = summarizeJobOutcomes([
      { kind: "user_edited" as JobOutcomeKind, createdAt: at(1) },
      { kind: "exported" as JobOutcomeKind, createdAt: at(2) },
    ]);
    expect(summary.counts.user_edited).toBe(1);
    expect(summary.counts.exported).toBe(1);
    expect(summary.latestDecision).toBeNull();
    expect(summary.taskSucceeded).toBe(false);
  });

  test("the most recent decision decides the outcome", async () => {
    const { summarizeJobOutcomes } = await import("../job-outcome");

    const acceptedThenRejected = summarizeJobOutcomes([
      { kind: "accepted" as JobOutcomeKind, createdAt: at(1) },
      { kind: "rejected" as JobOutcomeKind, createdAt: at(5) },
    ]);
    expect(acceptedThenRejected.latestDecision?.kind).toBe("rejected");
    expect(acceptedThenRejected.taskSucceeded).toBe(false);

    const rejectedThenAccepted = summarizeJobOutcomes([
      { kind: "rejected" as JobOutcomeKind, createdAt: at(1) },
      { kind: "user_edited" as JobOutcomeKind, createdAt: at(3) },
      { kind: "accepted" as JobOutcomeKind, createdAt: at(9) },
    ]);
    expect(rejectedThenAccepted.latestDecision?.kind).toBe("accepted");
    expect(rejectedThenAccepted.taskSucceeded).toBe(true);
  });

  test("an acceptance for an older artifact version does not mark the current result as accepted", async () => {
    const { summarizeJobOutcomes } = await import("../job-outcome");
    const staleAcceptance = summarizeJobOutcomes(
      [{ kind: "accepted" as JobOutcomeKind, createdAt: at(1), artifactVersionId: "version-1" }],
      "version-2",
    );
    expect(staleAcceptance.latestDecision?.kind).toBe("accepted");
    expect(staleAcceptance.taskSucceeded).toBe(false);

    const currentAcceptance = summarizeJobOutcomes(
      [{ kind: "accepted" as JobOutcomeKind, createdAt: at(1), artifactVersionId: "version-2" }],
      "version-2",
    );
    expect(currentAcceptance.taskSucceeded).toBe(true);
  });
});
