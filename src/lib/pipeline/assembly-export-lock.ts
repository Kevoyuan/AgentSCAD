import { randomUUID } from "crypto";
import type { Job } from "@prisma/client";
import { db } from "@/lib/db";
import { EXECUTION_TTL_MS, JOB_EXECUTION_FIELD, JobExecutionConflict, JobExecutionStopped } from "./job-execution";

/** Reuse the execution mutex without modifying the job or its completedAt. */
export async function claimAssemblyExport(job: Job) {
  const id = `execution:${job.id}`, token = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      await tx.jobVersion.deleteMany({ where: { id, field: JOB_EXECUTION_FIELD, createdAt: { lt: new Date(Date.now() - EXECUTION_TTL_MS) } } });
      await tx.jobVersion.create({ data: { id, jobId: job.id, field: JOB_EXECUTION_FIELD, newValue: token, changedBy: "system" } });
      const current = await tx.job.findFirst({ where: { id: job.id, state: job.state, updatedAt: job.updatedAt, scadSource: job.scadSource }, select: { id: true } });
      if (!current) throw new JobExecutionConflict();
    });
  } catch (error) {
    if (error instanceof JobExecutionConflict) throw error;
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2003", "P2034"].includes(String(error.code))) throw new JobExecutionConflict();
    throw error;
  }
  return {
    async heartbeat() {
      const renewed = await db.jobVersion.updateMany({ where: { id, newValue: token, createdAt: { gte: new Date(Date.now() - EXECUTION_TTL_MS) } }, data: { createdAt: new Date() } });
      if (renewed.count !== 1) throw new JobExecutionStopped();
    },
    async release() { await db.jobVersion.deleteMany({ where: { id, newValue: token } }); },
  };
}
