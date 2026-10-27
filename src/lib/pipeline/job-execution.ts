import { randomUUID } from "crypto";
import type { Job, Prisma } from "@prisma/client";
import type { ExecutionProgress } from "./execution-progress";
import { db } from "@/lib/db";

// A reserved, temporary JobVersion row provides a database-wide mutex without
// a schema migration. It is excluded from user history and removed on release.
export const JOB_EXECUTION_FIELD = "__execution_lock";
export const EXECUTION_TTL_MS = 15 * 60_000;

export class JobExecutionConflict extends Error {
  constructor(message = "Job is already running or has changed; refresh before retrying") {
    super(message);
    this.name = "JobExecutionConflict";
  }
}

export class JobExecutionStopped extends Error {
  constructor() {
    super("Job execution was cancelled, deleted, or superseded");
    this.name = "JobExecutionStopped";
  }
}

export type JobExecution = Awaited<ReturnType<typeof claimJobExecution>>;

export const PROCESSABLE_JOB_STATES = [
  "NEW",
  "CANCELLED",
  "DELIVERED",
  "VALIDATION_FAILED",
  "GEOMETRY_FAILED",
  "RENDER_FAILED",
  "HUMAN_REVIEW",
];

export function canProcessJobState(state?: string | null): boolean {
  return PROCESSABLE_JOB_STATES.includes(state ?? "NEW");
}

export function processableJobStatesMessage(): string {
  return PROCESSABLE_JOB_STATES.join(", ");
}

export async function claimJobExecution(
  job: Job,
  state: string,
  data: Prisma.JobUpdateManyMutationInput = {},
) {
  if (typeof db.$transaction !== "function" || !db.jobVersion) {
    return {
      async assertActive() {},
      async heartbeat(_progress?: ExecutionProgress) {},
      async update(args: { data: Prisma.JobUpdateManyMutationInput; where?: Prisma.JobWhereInput }) {
        if (db.job?.update) {
          return db.job.update({
            where: { id: job.id },
            data: args.data as Prisma.JobUpdateInput,
          });
        }
        return { ...job, ...args.data } as Job;
      },
      async release() {},
    };
  }

  const lockId = `execution:${job.id}`;
  const token = randomUUID();
  const createdAt = new Date();
  try {
    await db.$transaction(async (tx) => {
      await tx.jobVersion.deleteMany({
        where: { id: lockId, field: JOB_EXECUTION_FIELD, createdAt: { lt: new Date(Date.now() - EXECUTION_TTL_MS) } },
      });
      await tx.jobVersion.create({
        data: { id: lockId, jobId: job.id, field: JOB_EXECUTION_FIELD, newValue: token, changedBy: "system", createdAt },
      });
      const claimed = await tx.job.updateMany({
        where: { id: job.id, state: job.state, updatedAt: job.updatedAt },
        data: { ...data, state, completedAt: null },
      });
      if (claimed.count !== 1) throw new JobExecutionConflict();
    });
  } catch (error) {
    if (error instanceof JobExecutionConflict) throw error;
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2003", "P2034"].includes(String(error.code))) {
      throw new JobExecutionConflict();
    }
    throw error;
  }

  const where = (): Prisma.JobWhereInput => ({
    id: job.id,
    state: { notIn: ["CANCELLED", "DELETING"] },
    versions: { some: { id: lockId, newValue: token, createdAt: { gte: new Date(Date.now() - EXECUTION_TTL_MS) } } },
  });
  return {
    async assertActive() {
      if (!await db.job.findFirst({ where: where(), select: { id: true } })) {
        throw new JobExecutionStopped();
      }
    },
    async heartbeat(progress?: ExecutionProgress) {
      // The token and unexpired lease fence an old worker out after a takeover.
      await db.$transaction(async (tx) => {
        if (!await tx.job.findFirst({ where: where(), select: { id: true } })) throw new JobExecutionStopped();
        const renewed = await tx.jobVersion.updateMany({
          where: { id: lockId, newValue: token, createdAt: { gte: new Date(Date.now() - EXECUTION_TTL_MS) } },
          data: { createdAt: new Date(), ...(progress ? { oldValue: JSON.stringify(progress) } : {}) },
        });
        if (renewed.count !== 1) throw new JobExecutionStopped();
      });
    },
    async update(args: { data: Prisma.JobUpdateManyMutationInput; where?: Prisma.JobWhereInput }) {
      return db.$transaction(async (tx) => {
        const updated = await tx.job.updateMany({
          where: args.where ? { AND: [where(), args.where] } : where(),
          data: args.data,
        });
        if (updated.count !== 1) throw new JobExecutionStopped();
        return tx.job.findUniqueOrThrow({ where: { id: job.id } });
      });
    },
    async release() {
      // Do not remove another worker's lock or mask the original result.
      try {
        await db.jobVersion.deleteMany({ where: { id: lockId, newValue: token } });
      } catch (error) {
        console.error("Failed to release job execution lock", { jobId: job.id, error });
      }
    },
  };
}

const RUNNING_STATES = ["DEBUGGING", "REPAIRING", "SCAD_GENERATED", "RENDERED", "VALIDATED"];

/** Recover a crashed worker without ever stealing a fresh lease. */
export async function recoverStaleJobExecution(job: Job): Promise<Job> {
  if (!RUNNING_STATES.includes(job.state) || !db.jobVersion?.findUnique) return job;
  const cutoff = new Date(Date.now() - EXECUTION_TTL_MS);
  const lock = await db.jobVersion.findUnique({ where: { id: `execution:${job.id}` } });
  if (lock ? lock.createdAt >= cutoff : job.updatedAt >= cutoff) return job;
  return db.$transaction(async (tx) => {
    const recovered = await tx.job.updateMany({
      where: { id: job.id, state: job.state, updatedAt: job.updatedAt,
        versions: { none: { field: JOB_EXECUTION_FIELD, createdAt: { gte: cutoff } } } },
      data: { state: "HUMAN_REVIEW", completedAt: null,
        repairHistory: JSON.stringify(safeLogs(job.repairHistory).filter(entry => !(entry && typeof entry === "object" && "type" in entry && entry.type === "compile_repair_lease"))),
        executionLogs: JSON.stringify([...safeLogs(job.executionLogs), {
          timestamp: new Date().toISOString(), event: "EXECUTION_INTERRUPTED",
          message: "Execution heartbeat expired. Saved source is available; retry to resume processing.",
        }]) },
    });
    if (recovered.count === 1) await tx.jobVersion.deleteMany({ where: { id: `execution:${job.id}`, createdAt: { lt: cutoff } } });
    return await tx.job.findUnique({ where: { id: job.id } }) ?? job;
  });
}

function safeLogs(value: string | null): unknown[] {
  try { const logs = JSON.parse(value || "[]"); return Array.isArray(logs) ? logs : []; } catch { return []; }
}

export async function readExecutionProgress(job: Job): Promise<ExecutionProgress | null> {
  if (!RUNNING_STATES.includes(job.state) || !db.jobVersion?.findUnique) return null;
  const lock = await db.jobVersion.findUnique({ where: { id: `execution:${job.id}` } });
  try { return lock?.oldValue ? JSON.parse(lock.oldValue) : null; } catch { return null; }
}
