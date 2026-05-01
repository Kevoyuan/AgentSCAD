import { db } from "@/lib/db";
import type { ExecutionLogEntry, ParameterDef } from "@/lib/harness/types";

export { db };

export function appendLog(
  existingLogs: string | null | undefined,
  event: string,
  message: string
): string {
  let logs: ExecutionLogEntry[] = [];
  if (existingLogs) {
    try {
      logs = JSON.parse(existingLogs) as ExecutionLogEntry[];
    } catch {
      logs = [];
    }
  }

  logs.push({
    timestamp: new Date().toISOString(),
    event,
    message,
  });

  return JSON.stringify(logs);
}

export function parameterDefsToValues(parameters: ParameterDef[]): Record<string, number> {
  return parameters.reduce<Record<string, number>>((acc, parameter) => {
    acc[parameter.key] = parameter.value;
    return acc;
  }, {});
}

export async function findJobById(id: string) {
  return db.job.findUnique({ where: { id } });
}

export async function getJob(id: string) {
  return findJobById(id);
}

export async function updateJobState(
  id: string,
  state: string,
  data: Record<string, unknown> = {}
) {
  return db.job.update({
    where: { id },
    data: {
      ...data,
      state,
    },
  });
}

export async function appendExecutionLog(
  id: string,
  event: string,
  message: string
) {
  const job = await getJob(id);
  if (!job) return null;

  return db.job.update({
    where: { id },
    data: {
      executionLogs: appendLog(job.executionLogs, event, message),
    },
  });
}

export async function saveGeneratedScad(
  id: string,
  fields: Record<string, unknown>
) {
  return db.job.update({
    where: { id },
    data: fields,
  });
}

export async function saveArtifacts(
  id: string,
  fields: Record<string, unknown>
) {
  return db.job.update({
    where: { id },
    data: fields,
  });
}

export async function saveValidation(
  id: string,
  fields: Record<string, unknown>
) {
  return db.job.update({
    where: { id },
    data: fields,
  });
}

export async function markFailed(
  id: string,
  state: string,
  message: string,
  extraFields: Record<string, unknown> = {}
) {
  const job = await getJob(id);

  return db.job.update({
    where: { id },
    data: {
      ...extraFields,
      state,
      executionLogs: appendLog(job?.executionLogs, state, message),
    },
  });
}

export async function markDelivered(id: string) {
  return db.job.update({
    where: { id },
    data: {
      state: "DELIVERED",
      completedAt: new Date(),
    },
  });
}

export async function incrementRetryCount(id: string): Promise<number> {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new Error(`Job not found: ${id}`);
  const next = (job.retryCount ?? 0) + 1;
  await db.job.update({
    where: { id },
    data: { retryCount: next },
  });
  return next;
}

export async function incrementLlmCallCount(id: string): Promise<number> {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new Error(`Job not found: ${id}`);
  // llmCallCount is tracked via cadIntentJson parsing or a separate field
  // For now, use a simple approach: read current executionLogs to count calls
  return 0; // placeholder — actual counting happens in the pipeline
}
