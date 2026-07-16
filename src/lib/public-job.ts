export function sanitizeRenderLogForClient(
  rawRenderLog: string | null | undefined
): string | null | undefined {
  if (!rawRenderLog) return rawRenderLog;

  try {
    const renderLog = JSON.parse(rawRenderLog) as Record<string, unknown>;
    delete renderLog.artifact_pathnames;
    return JSON.stringify(renderLog);
  } catch {
    return rawRenderLog;
  }
}

export function toPublicJob<T extends object>(job: T): T {
  const renderLog = (job as { renderLog?: string | null }).renderLog;
  if (!renderLog) return job;
  return {
    ...job,
    renderLog: sanitizeRenderLogForClient(renderLog),
  };
}

export function toPublicJobOrNull<T extends object>(job: T | null): T | null {
  return job ? toPublicJob(job) : null;
}
