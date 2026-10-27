import { afterAll, expect, setSystemTime, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_LEASE_TEST_CHILD !== "1") {
  test("execution lease regression suite uses an isolated SQLite database", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-leases-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_LEASE_TEST_CHILD: "1" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 20000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 45000);
} else {
  const { db } = await import("@/lib/db");
  const { claimJobExecution, recoverStaleJobExecution, readExecutionProgress, JobExecutionStopped, JobExecutionConflict } = await import("../job-execution");
  afterAll(async () => { setSystemTime(); await db.$disconnect(); });

  test("heartbeats keep a 60-minute run active, persist progress and prevent takeover", async () => {
    const start = Date.now();
    const job = await db.job.create({ data: { inputRequest: "lease test" } });
    const run = await claimJobExecution(job, "DEBUGGING");
    for (let minute = 10; minute <= 60; minute += 10) {
      setSystemTime(new Date(start + minute * 60000));
      await run.heartbeat({ step: "compiling_scad", message: "Compiling", startedAt: new Date(start).toISOString(), stageStartedAt: new Date(start).toISOString(), updatedAt: new Date().toISOString() });
      await run.assertActive();
    }
    const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect((await recoverStaleJobExecution(current)).state).toBe("DEBUGGING");
    expect((await readExecutionProgress(current))?.step).toBe("compiling_scad");
    await expect(claimJobExecution(current, "DEBUGGING")).rejects.toBeInstanceOf(JobExecutionConflict);
    await db.job.update({ where: { id: job.id }, data: { state: "CANCELLED" } });
    await expect(run.heartbeat()).rejects.toBeInstanceOf(JobExecutionStopped);
    await run.release();
    setSystemTime();
  });

  test("stale worker cannot renew or overwrite a recovered job or delete a successor lock", async () => {
    const start = Date.now();
    const job = await db.job.create({ data: { inputRequest: "crashed worker", scadSource: "cube(2);" } });
    const oldRun = await claimJobExecution(job, "DEBUGGING");
    setSystemTime(new Date(start + 16 * 60000));
    const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    const recovered = await recoverStaleJobExecution(current);
    expect(recovered.state).toBe("HUMAN_REVIEW");
    expect(recovered.scadSource).toBe("cube(2);");
    expect(recovered.executionLogs).toContain("EXECUTION_INTERRUPTED");
    const successor = await claimJobExecution(recovered, "DEBUGGING");
    await expect(oldRun.heartbeat()).rejects.toBeInstanceOf(JobExecutionStopped);
    await expect(oldRun.update({ data: { state: "DELIVERED" } })).rejects.toBeInstanceOf(JobExecutionStopped);
    await oldRun.release();
    await successor.assertActive();
    await successor.release();
    setSystemTime();
  });
}
