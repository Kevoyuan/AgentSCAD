import { describe, expect, test } from "bun:test";
import {
  runSourcePoseWithinBudget,
  SourcePoseDeadlineExceeded,
  SourcePoseLeaseAborted,
  TOTAL_SOURCE_POSE_BUDGET_MS,
} from "./source-pose-budget";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("cumulative source-pose execution budget", () => {
  test("an on-time observation returns its real value and detaches abort listeners", async () => {
    const upstream = new AbortController();
    let rendererSignal: AbortSignal | undefined;
    const result = await runSourcePoseWithinBudget(upstream.signal, async signal => {
      rendererSignal = signal;
      return { status: "PASS", samples: 3 };
    }, 15);
    expect(result).toEqual({ status: "PASS", samples: 3 });
    await delay(25);
    expect(rendererSignal?.aborted).toBe(false);
    upstream.abort(new Error("Later job change"));
    expect(rendererSignal?.aborted).toBe(false);
  });

  test("total wall deadline aborts a cooperative renderer and never returns a partial PASS", async () => {
    const upstream = new AbortController();
    let observedSignal: AbortSignal | undefined;
    await expect(runSourcePoseWithinBudget(upstream.signal, signal => new Promise<string>((resolve, reject) => {
      observedSignal = signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), 8)).rejects.toBeInstanceOf(SourcePoseDeadlineExceeded);
    expect(observedSignal?.aborted).toBe(true);
    expect(upstream.signal.aborted).toBe(false);
  });

  test("a renderer that ignores abort cannot turn an expired deadline into PASS", async () => {
    const upstream = new AbortController();
    await expect(runSourcePoseWithinBudget(upstream.signal, async () => {
      await delay(25);
      return "PASS";
    }, 5)).rejects.toBeInstanceOf(SourcePoseDeadlineExceeded);
  });

  test("upstream job/lease cancellation retains priority over deadline, before and during rendering", async () => {
    const upstream = new AbortController();
    upstream.abort(new Error("Version changed"));
    let started = false;
    await expect(runSourcePoseWithinBudget(upstream.signal, async () => {
      started = true;
      return "PASS";
    }, 100)).rejects.toBeInstanceOf(SourcePoseLeaseAborted);
    expect(started).toBe(false);

    const later = new AbortController();
    const pending = runSourcePoseWithinBudget(later.signal, signal => new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), 100);
    later.abort(new Error("Lease lost"));
    await expect(pending).rejects.toBeInstanceOf(SourcePoseLeaseAborted);
  });

  test("invalid deadlines cannot bypass or extend the 180-second server cap", async () => {
    const upstream = new AbortController();
    for (const budget of [0, -1, 1.5, Number.NaN, TOTAL_SOURCE_POSE_BUDGET_MS + 1]) {
      await expect(runSourcePoseWithinBudget(upstream.signal, async () => "PASS", budget)).rejects.toThrow("Invalid cumulative");
    }
  });
});
