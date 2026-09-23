import { randomUUID } from "crypto";
import type { Job, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// A reserved, temporary JobVersion row provides a database-wide mutex without
// a schema migration. It is excluded from user history and removed on release.
export const JOB_EXECUTION_FIELD = "__execution_lock";
const EXECUTION_TTL_MS = 15 * 60_000;

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
