import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_BOOLEAN_PARAMETER_CHILD !== "1") {
  test("parameter route saves and restores literal boolean controls from a legacy numeric schema", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "agentscad-boolean-parameters-"));
    writeFileSync(path.join(directory, "test.db"), "");
    const env = { ...process.env, DATABASE_URL: `file:${directory}/test.db`, AGENTSCAD_BOOLEAN_PARAMETER_CHILD: "1" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
        { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 30000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60000);
} else {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { PATCH } = await import("@/app/api/jobs/[id]/parameters/route");
  const { createHash, randomUUID } = await import("node:crypto");
  afterAll(async () => db.$disconnect());

  test("typed boolean edits use the actual route, source writer, ledger and lease", async () => {
    const token = randomUUID();
    const browserSessionId = createHash("sha256").update(`agentscad-job-session:v1:${token}`).digest("hex");
    const original = "hinge_angle = 0;\nshow_angle_clamp = true;\nmodule body() { hidden = true; }\nbody();";
    const numeric = { key: "hinge_angle", label: "Angle", kind: "integer", unit: "deg", value: 0,
      min: -180, max: 180, step: 1, source: "artifact", editable: true, description: "", group: "Parameters" };
    const job = await db.job.create({ data: { browserSessionId, state: "NEW", inputRequest: "Parameter route fixture",
      scadSource: original, parameterSchema: JSON.stringify([numeric]), parameterValues: JSON.stringify({ hinge_angle: 0 }) } });
    const context = { params: Promise.resolve({ id: job.id }) };
    const patch = (parameters: Record<string, unknown>) => PATCH(new NextRequest("http://localhost/api/parameters", {
      method: "PATCH", headers: { cookie: `agentscad-job-session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ parameters }),
    }), context);
    const changed = await patch({ hinge_angle: 90, show_angle_clamp: false });
    expect(changed.status).toBe(200);
    const saved = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.scadSource).toContain("show_angle_clamp = false;");
    expect(saved.scadSource).toContain("hinge_angle = 90;");
    expect(saved.scadSource).toContain("module body() { hidden = true; }");
    expect(JSON.parse(saved.parameterValues!).show_angle_clamp).toBe(false);
    expect(JSON.parse(saved.parameterSchema!).find((entry: { key: string }) => entry.key === "show_angle_clamp"))
      .toMatchObject({ kind: "boolean", value: true });
    expect((await changed.json()).rendered).toBe(false);
    for (const invalid of [0, "false", null, []]) {
      expect((await patch({ show_angle_clamp: invalid })).status).toBe(422);
    }
    expect((await patch({ hidden: false })).status).toBe(422);
    expect((await patch({ show_angle_clamp: true })).status).toBe(200);
    const reset = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(reset.scadSource).toContain("show_angle_clamp = true;");
    expect(JSON.parse(reset.parameterValues!).show_angle_clamp).toBe(true);
    expect(reset.llmCallCount).toBe(0);
    expect(await db.jobVersion.count({ where: { jobId: job.id, field: "__execution_lock" } })).toBe(0);
    expect((await db.jobOutcome.findMany({ where: { jobId: job.id } })).map(item => item.kind))
      .toEqual(["user_edited", "user_edited"]);
    await db.job.update({ where: { id: job.id }, data: { parameterSchema: null } });
    expect((await patch({ hinge_angle: 45, show_angle_clamp: false })).status).toBe(200);
    const withoutSchema = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(withoutSchema.parameterSchema).toBeNull();
    expect(withoutSchema.scadSource).toContain("show_angle_clamp = false;");
  });
}
