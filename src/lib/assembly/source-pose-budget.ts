/** A cumulative deadline for all independently rendered source poses, not per process. */
export const TOTAL_SOURCE_POSE_BUDGET_MS = 180_000;

export class SourcePoseDeadlineExceeded extends Error {
  constructor() {
    super("The complete source-pose inspection exceeded its 180-second execution budget. No motion approval was recorded.");
    this.name = "SourcePoseDeadlineExceeded";
  }
}
export class SourcePoseLeaseAborted extends Error {
  constructor() {
    super("The source-pose inspection was cancelled because the job or execution lease changed.");
    this.name = "SourcePoseLeaseAborted";
  }
}

/**
 * Includes local-part rendering, three independent reference renders, bundle
 * reconstruction and final comparison under ONE deadline. The upstream lease
 * signal has priority over timeout when both are aborted. Task completion
 * after a deadline must never be treated as PASS even if the renderer ignored
 * the abort request. All timers/listeners are detached after the operation.
 */
export async function runSourcePoseWithinBudget<T>(
  upstream: AbortSignal,
  task: (signal: AbortSignal) => Promise<T>,
  budgetMs = TOTAL_SOURCE_POSE_BUDGET_MS,
): Promise<T> {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > TOTAL_SOURCE_POSE_BUDGET_MS) {
    throw new Error("Invalid cumulative source-pose execution budget.");
  }
  if (upstream.aborted) throw new SourcePoseLeaseAborted();
  const combined = new AbortController();
  let timedOut = false;
  const onUpstreamAbort = () => combined.abort(upstream.reason);
  upstream.addEventListener("abort", onUpstreamAbort, { once: true });
  if (upstream.aborted) onUpstreamAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    combined.abort(new SourcePoseDeadlineExceeded());
  }, budgetMs);
  try {
    if (upstream.aborted) throw new SourcePoseLeaseAborted();
    const result = await task(combined.signal);
    if (upstream.aborted) throw new SourcePoseLeaseAborted();
    if (timedOut) throw new SourcePoseDeadlineExceeded();
    return result;
  } catch (error) {
    if (upstream.aborted) throw new SourcePoseLeaseAborted();
    if (timedOut) throw new SourcePoseDeadlineExceeded();
    throw error;
  } finally {
    clearTimeout(timer);
    upstream.removeEventListener("abort", onUpstreamAbort);
  }
}
