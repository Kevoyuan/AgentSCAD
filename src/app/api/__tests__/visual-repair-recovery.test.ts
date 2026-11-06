import { afterAll, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_VISUAL_CLAIM_CHILD !== "1") {
  test("visual repair recovery only updates its own claimed job", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-requirements-route-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_VISUAL_CLAIM_CHILD: "1", API_SECRET: "requirements-test-secret" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 40000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
} else {
  const {countLlmCall} = await import("@/lib/model-runtime");
  let previewFails = true;
  let replaceClaim: (() => Promise<void>) | null = null;
  const artifactStore = await import("@/lib/tools/artifact-store");
  mock.module("@/lib/tools/artifact-store", () => ({
    ...artifactStore,
    materializeStoredArtifact: async () => {
      if (previewFails) throw new Error("Injected preview failure");
      return {filePath:"/unused-preview.png",temporary:false};
    },
    cleanupArtifactWorkspace: async () => {},
  }));
  mock.module("@/lib/repair/visual-repair-controller", () => ({
    runVisualRepair: async () => {countLlmCall(); countLlmCall(); if (replaceClaim) await replaceClaim(); throw new Error("Injected assembly rejection");},
    runVisualAnalysis: async () => {},
    resolvePostRepairOutcome: () => {},
    visualRepairReportToValidationResult: () => {},
  }));
  const {db} = await import("@/lib/db");
  const {POST} = await import("@/app/api/jobs/[id]/visual-repair/route");
  afterAll(async () => db.$disconnect());
  test("preflight errors preserve another repair and claimed failures retain source", async () => {
    for (const state of ["REPAIRING", "DELIVERED"]) {
      previewFails = state === "REPAIRING";
      const job = await db.job.create({data:{inputRequest:"hinge",state,scadSource:"cube(1);",llmCallCount:7,executionLogs:"original"}});
      const response = await POST(new Request("http://localhost/api/jobs/x/visual-repair",{method:"POST",headers:{authorization:"Bearer requirements-test-secret"}}),{params:Promise.resolve({id:job.id})});
      expect(response.status).toBe(500);
      const saved = await db.job.findUniqueOrThrow({where:{id:job.id}});
      expect(saved.state).toBe(previewFails ? "REPAIRING" : "HUMAN_REVIEW");
      expect(saved.scadSource).toBe(job.scadSource);
      expect(saved.llmCallCount).toBe(previewFails ? 7 : 9);
      if (previewFails) expect(saved.executionLogs).toBe("original");
    }
  });

  test("an older failure cannot recover a replaced repair claim", async () => {
    previewFails = false;
    const job = await db.job.create({data:{inputRequest:"hinge",state:"DELIVERED",scadSource:"cube(1);",llmCallCount:7}});
    replaceClaim = async () => {
      await db.job.update({where:{id:job.id},data:{executionLogs:"new owner",scadSource:"cube(2);"}});
    };
    try {
      await POST(new Request("http://localhost/api/jobs/x/visual-repair",{method:"POST",headers:{authorization:"Bearer requirements-test-secret"}}),{params:Promise.resolve({id:job.id})});
      const saved = await db.job.findUniqueOrThrow({where:{id:job.id}});
      expect(saved.state).toBe("REPAIRING");
      expect(saved.executionLogs).toBe("new owner");
      expect(saved.scadSource).toBe("cube(2);");
      expect(saved.llmCallCount).toBe(9);
    } finally {replaceClaim = null;}
  });
}
