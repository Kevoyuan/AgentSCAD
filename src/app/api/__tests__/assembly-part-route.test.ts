import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_PART_ROUTE_CHILD !== "1") {
  test("assembly part route preserves source and session boundaries", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-part-route-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const fake = path.join(dir, "openscad");
    writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('fs');const out=process.argv[process.argv.indexOf('-o')+1];const buf=Buffer.alloc(134);buf.writeUInt32LE(1,80);buf.writeFloatLE(1,108);buf.writeFloatLE(1,124);setTimeout(()=>fs.writeFileSync(out,buf),200);\n`, { mode: 0o755 });
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_PART_ROUTE_CHILD: "1", API_SECRET: "assembly-test-secret", OPENSCAD_BIN: fake, AGENTSCAD_OPENSCAD_BACKEND: "native" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 30000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 50000);
} else {
  const { db } = await import("@/lib/db");
  const { PUT } = await import("@/app/api/jobs/[id]/assembly/route");
  const { GET } = await import("@/app/api/jobs/[id]/assembly/parts/[partId]/route");
  const { claimAssemblyExport } = await import("@/lib/pipeline/assembly-export-lock");
  const { assemblySpecificationHash, assemblyRecordId } = await import("@/lib/pipeline/assembly-spec-record");
  const { AssemblySpecSchema } = await import("@/lib/assembly/assembly-spec");
  afterAll(async () => db.$disconnect());
  const source = 'agentscad_part=""; if(agentscad_part=="base") cube(1);';
  const hash = createHash("sha256").update(source).digest("hex");
  const spec = { schemaVersion: 1, units: "mm", coordinateSystem: "right-handed", parts: [
    { id: "base", name: "base", selector: "base", source: "generated", material: null },
    { id: "screw", name: "screw", selector: "screw", source: "purchased", material: null },
  ], instances: [{ id: "base", partId: "base", subassemblyId: null, transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }], subassemblies: [], connections: [], groundedInstanceId: "base", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [] };
  const specHash = assemblySpecificationHash(AssemblySpecSchema.parse(spec));
  test("spec hash is stable across object-key order and sensitive to changed contracts", () => {
    const reversed = Object.fromEntries(Object.entries(spec).reverse());
    expect(assemblySpecificationHash(AssemblySpecSchema.parse(reversed))).toBe(specHash);
    expect(assemblySpecificationHash(AssemblySpecSchema.parse({ ...spec, unknowns: ["changed"] }))).not.toBe(specHash);
  });
  const admin = (url: string, method = "GET", body?: unknown) => new Request(url, { method, headers: { authorization: "Bearer assembly-test-secret", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
  const context = (id: string, partId = "base") => ({ params: Promise.resolve({ id, partId }) });
  const url = (h = hash, sh = specHash) => `http://localhost/api?sourceSha256=${h}&specSha256=${sh}`;
  async function create() {
    const job = await db.job.create({ data: { inputRequest: "test", state: "DELIVERED", scadSource: source, completedAt: new Date("2020-01-01T00:00:00Z") } });
    expect((await PUT(admin("http://localhost", "PUT", { spec, sourceSha256: hash, expectedSpecSha256: null }), { params: Promise.resolve({ id: job.id }) })).status).toBe(200);
    return await db.job.findUniqueOrThrow({ where: { id: job.id } });
  }
  test("returns candidate bytes with explicit unverified status without mutating verdict or job", async () => {
    const job = await create();
    const res = await GET(admin(url()), context(job.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-AgentSCAD-Verification")).toContain("NOT_RUN");
    expect(res.headers.get("X-AgentSCAD-Spec-SHA256")).toBe(specHash);
    expect((await res.arrayBuffer()).byteLength).toBe(134);
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.updatedAt.getTime()).toBe(job.updatedAt.getTime());
    expect(after.completedAt?.getTime()).toBe(job.completedAt?.getTime());
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });
  test("records deliberate exports against matching source versions only", async () => {
    const job = await create();
    const matching = await db.jobArtifactVersion.create({ data: { jobId: job.id, scadSource: source, scadHash: hash, createdAt: new Date("2020-01-01") } });
    await db.jobArtifactVersion.create({ data: { jobId: job.id, scadSource: "different", scadHash: "0".repeat(64), createdAt: new Date("2021-01-01") } });
    const response = await GET(admin(`${url()}&download=1`), context(job.id));
    expect(response.status).toBe(200);
    const outcomes = await db.jobOutcome.findMany({ where: { jobId: job.id } });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("exported");
    expect(outcomes[0].artifactVersionId).toBe(matching.id);
    const detail = JSON.parse(outcomes[0].detail!);
    expect(detail.partId).toBe("base");
    expect(detail.sourceSha256).toBe(hash);
    expect(detail.specSha256).toBe(specHash);
    expect(detail.partSha256).toBe(response.headers.get("X-AgentSCAD-Part-SHA256"));
    expect(await db.jobOutcome.count({ where: { jobId: job.id, kind: { in: ["accepted", "rejected"] } } })).toBe(0);
  });
  test("records a source without a matching artifact version as unbound", async () => {
    const job = await create();
    await db.jobArtifactVersion.create({ data: { jobId: job.id, scadSource: "old", scadHash: "0".repeat(64) } });
    expect((await GET(admin(`${url()}&download=1`), context(job.id))).status).toBe(200);
    expect((await db.jobOutcome.findFirstOrThrow({ where: { jobId: job.id } })).artifactVersionId).toBeNull();
  });
  test("rejects missing authorization, stale sources, purchased and failed jobs", async () => {
    const job = await create();
    expect((await GET(new Request(url()) as never, context(job.id))).status).toBe(401);
    expect((await GET(admin(url("0".repeat(64))), context(job.id))).status).toBe(409);
    expect((await GET(admin(url(hash, "0".repeat(64))), context(job.id))).status).toBe(409);
    expect((await GET(admin(`http://localhost/api?sourceSha256=${hash}`), context(job.id))).status).toBe(400);
    expect((await GET(admin(url()), context(job.id, "screw"))).status).toBe(404);
    await db.job.update({ where: { id: job.id }, data: { state: "GEOMETRY_FAILED" } });
    expect((await GET(admin(url()), context(job.id))).status).toBe(409);
  });
  test("rejects a stale spec before downloading and a spec changed during rendering", async () => {
    const job = await create();
    const changedSpec = { ...spec, unknowns: ["changed"] };
    const changedHash = assemblySpecificationHash(AssemblySpecSchema.parse(changedSpec));
    const rowId = assemblyRecordId(job.id);
    await db.jobVersion.update({ where: { id: rowId }, data: { newValue: JSON.stringify({ spec: changedSpec, sourceSha256: hash }) } });
    expect((await GET(admin(url()), context(job.id))).status).toBe(409);
    const pending = GET(admin(url(hash, changedHash)), context(job.id));
    let locked = false;
    for (let i = 0; i < 100; i++) {
      if (await db.jobVersion.findUnique({ where: { id: `execution:${job.id}` } })) { locked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(locked).toBe(true);
    await db.jobVersion.update({ where: { id: rowId }, data: { newValue: JSON.stringify({ spec, sourceSha256: hash }) } });
    expect((await pending).status).toBe(409);
  });
  test("rejects concurrent execution and source changes during rendering", async () => {
    const job = await create();
    const lease = await claimAssemblyExport(job);
    try { expect((await GET(admin(url()), context(job.id))).status).toBe(409); } finally { await lease.release(); }
    await db.job.update({ where: { id: job.id }, data: { state: "DELIVERED" } });
    const pending = GET(admin(url()), context(job.id));
    let locked = false;
    for (let i = 0; i < 100; i++) {
      if (await db.jobVersion.findUnique({ where: { id: `execution:${job.id}` } })) { locked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(locked).toBe(true);
    await db.job.update({ where: { id: job.id }, data: { scadSource: "cube(2);" } });
    expect((await pending).status).toBe(409);
  });
  test("does not expose a job to another browser session", async () => {
    const token = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const session = createHash("sha256").update(`agentscad-job-session:v1:${token}`).digest("hex");
    const job = await db.job.create({ data: { inputRequest: "private", browserSessionId: session, state: "DELIVERED", scadSource: source } });
    const browser = (sessionToken: string) => new Request(url(), { headers: { "x-agentscad-job-session": sessionToken } }) as never;
    expect((await GET(browser(other), context(job.id))).status).toBe(404);
  });
}
