import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_ASSEMBLY_ROUTE_CHILD !== "1") {
  test("assembly route uses isolated SQLite and enforces stale source and execution leases", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-assembly-route-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_ASSEMBLY_ROUTE_CHILD: "1", API_SECRET: "assembly-test-secret" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 20000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 45000);
} else {
  const { db } = await import("@/lib/db");
  const { GET, PUT } = await import("@/app/api/jobs/[id]/assembly/route");
  const { claimJobExecution } = await import("@/lib/pipeline/job-execution");
  afterAll(async () => db.$disconnect());
  const source = "cube(5);";
  const hash = createHash("sha256").update(source).digest("hex");
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [{ id: "base", name: "base", selector: "base", source: "generated", material: null }],
    instances: [{ id: "base", partId: "base", subassemblyId: null, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    subassemblies: [], connections: [], groundedInstanceId: "base", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const request = (method: string, body?: unknown, authenticated = true) => new Request("http://localhost", {
    method, headers: { ...(authenticated ? { authorization: "Bearer assembly-test-secret" } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;

  test("persists a source-bound contract, fails closed on source changes and keeps evidence unexecuted", async () => {
    const job = await db.job.create({ data: { inputRequest: "test", scadSource: source, state: "DELIVERED" } });
    const context = { params: Promise.resolve({ id: job.id }) };
    expect((await GET(request("GET", undefined, false), context)).status).toBe(401);
    expect((await PUT(request("PUT", { spec, sourceSha256: "0".repeat(64), expectedSpecSha256: null }), context)).status).toBe(409);
    expect((await PUT(request("PUT", { spec, sourceSha256: hash, expectedSpecSha256: null }), context)).status).toBe(200);
    const saved = await (await GET(request("GET"), context)).json();
    expect(saved.spec.parts[0].id).toBe("base");
    expect(saved.stale).toBe(false);
    expect(saved.evidence.motion.status).toBe("NOT_RUN");
    await db.job.update({ where: { id: job.id }, data: { scadSource: "cube(6);" } });
    expect((await (await GET(request("GET"), context)).json()).stale).toBe(true);
    expect((await PUT(request("PUT", { spec, sourceSha256: hash, expectedSpecSha256: saved.specSha256 }), context)).status).toBe(409);
  });
  test("rejects writes while another execution owns the job", async () => {
    const job = await db.job.create({ data: { inputRequest: "lease", scadSource: source, state: "DELIVERED" } });
    const run = await claimJobExecution(job, "DEBUGGING");
    try { expect((await PUT(request("PUT", { spec, sourceSha256: hash, expectedSpecSha256: null }), { params: Promise.resolve({ id: job.id }) })).status).toBe(409); }
    finally { await run.release(); }
  });
  test("isolates assembly contracts between browser sessions", async () => {
    const token = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const session = createHash("sha256").update(`agentscad-job-session:v1:${token}`).digest("hex");
    const job = await db.job.create({ data: { inputRequest: "private", browserSessionId: session, scadSource: source } });
    const context = { params: Promise.resolve({ id: job.id }) };
    const browserRequest = (method: string, sessionToken: string, body?: unknown) => new Request("http://localhost", {
      method, headers: { "x-agentscad-job-session": sessionToken, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as never;
    expect((await PUT(browserRequest("PUT", token, { spec, sourceSha256: hash, expectedSpecSha256: null }), context)).status).toBe(200);
    expect((await GET(browserRequest("GET", other), context)).status).toBe(404);
    expect((await PUT(browserRequest("PUT", other, { spec, sourceSha256: hash, expectedSpecSha256: null }), context)).status).toBe(404);
    expect((await GET(browserRequest("GET", token), context)).status).toBe(200);
  });
  test("exposes a validated generated contract bound to the current source, and preserves user edits", async () => {
    const generatedSource = `/* AGENTSCAD_ASSEMBLY_V1\n${JSON.stringify(spec)}\nEND_AGENTSCAD_ASSEMBLY */\ncube(5);`;
    const job = await db.job.create({ data: { inputRequest: "generated", scadSource: generatedSource } });
    const context = { params: Promise.resolve({ id: job.id }) };
    const result = await (await GET(request("GET"), context)).json();
    expect(result.provenance).toBe("generated");
    expect(result.sourceSha256).toBe(createHash("sha256").update(generatedSource).digest("hex"));
    expect(result.evidence.identity.status).toBe("NOT_RUN");
    const changed = { ...spec, unknowns: ["manual correction"] };
    expect((await PUT(request("PUT", { spec: changed, sourceSha256: result.sourceSha256, expectedSpecSha256: result.specSha256 }), context)).status).toBe(200);
    const saved = await (await GET(request("GET"), context)).json();
    expect(saved.provenance).toBe("user");
    expect(saved.spec.unknowns).toEqual(["manual correction"]);
    await db.job.update({ where: { id: job.id }, data: { scadSource: generatedSource + "\n// edited" } });
    expect((await (await GET(request("GET"), context)).json()).stale).toBe(true);
  });
  test("reports malformed generated data rather than treating it as a valid contract", async () => {
    const job = await db.job.create({ data: { inputRequest: "invalid", scadSource: "/* AGENTSCAD_ASSEMBLY_V1\nnot-json\nEND_AGENTSCAD_ASSEMBLY */\ncube(2);" } });
    const response = await (await GET(request("GET"), { params: Promise.resolve({ id: job.id }) })).json();
    expect(response.spec).toBeNull();
    expect(response.embeddedStatus).toBe("invalid");
    expect(response.evidence.geometry.status).toBe("NOT_RUN");
  });
  test("rejects a stale editor even when the source has not changed", async () => {
    const job = await db.job.create({ data: { inputRequest: "edit conflict", scadSource: source } });
    const context = { params: Promise.resolve({ id: job.id }) };
    expect((await PUT(request("PUT", { spec, sourceSha256: hash }), context)).status).toBe(400);
    const first = await (await GET(request("GET"), context)).json();
    expect(first.specSha256).toBeNull();
    const firstSave = await PUT(request("PUT", { spec, sourceSha256: hash, expectedSpecSha256: first.specSha256 }), context);
    expect(firstSave.status).toBe(200);
    expect((await PUT(request("PUT", { spec: { ...spec, unknowns: ["stale"] }, sourceSha256: hash, expectedSpecSha256: first.specSha256 }), context)).status).toBe(409);
    const snapshot = await (await GET(request("GET"), context)).json();
    expect(snapshot.spec.unknowns).toEqual([]);
    const changed = { ...spec, unknowns: ["changed"] };
    expect((await PUT(request("PUT", { spec: changed, sourceSha256: hash, expectedSpecSha256: snapshot.specSha256 }), context)).status).toBe(200);
    expect((await PUT(request("PUT", { spec, sourceSha256: hash, expectedSpecSha256: snapshot.specSha256 }), context)).status).toBe(409);
    expect((await (await GET(request("GET"), context)).json()).spec.unknowns).toEqual(["changed"]);
  });
  test("keeps an append-only revision history that source versions do not expose", async () => {
    const { GET: getRevisions } = await import("@/app/api/jobs/[id]/assembly/revisions/route");
    const { GET: getVersions } = await import("@/app/api/jobs/[id]/versions/route");
    const job = await db.job.create({ data: { inputRequest: "history", scadSource: source, state: "DELIVERED" } });
    const context = { params: Promise.resolve({ id: job.id }) };
    let expected: string | null = null;
    for (let i = 0; i < 3; i++) {
      const response = await PUT(request("PUT", { spec: { ...spec, unknowns: [`edit ${i}`] }, sourceSha256: hash, expectedSpecSha256: expected }), context);
      expect(response.status).toBe(200);
      expected = (await response.json()).specSha256;
    }
    const history = await (await getRevisions(request("GET"), context)).json();
    expect(history.revisions.map((revision: { revision: number }) => revision.revision)).toEqual([3, 2, 1]);
    expect(history.revisions[0].spec.unknowns).toEqual(["edit 2"]);
    expect(history.revisions[2].spec.unknowns).toEqual(["edit 0"]);
    expect(history.revisions.every((revision: { stale: boolean }) => revision.stale === false)).toBe(true);
    const versions = await (await getVersions(request("GET"), context)).json();
    expect(versions.versions.some((version: { field: string }) => version.field.startsWith("__assembly"))).toBe(false);
    await db.job.update({ where: { id: job.id }, data: { scadSource: "cube(9);" } });
    const stale = await (await getRevisions(request("GET"), context)).json();
    expect(stale.revisions.every((revision: { stale: boolean }) => revision.stale === true)).toBe(true);
    expect((await getRevisions(new Request("http://localhost") as never, context)).status).toBe(401);
    expect((await getRevisions(request("GET"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
  });
  test("prunes history beyond the retention limit instead of growing without bound", async () => {
    const { GET: getRevisions } = await import("@/app/api/jobs/[id]/assembly/revisions/route");
    const { ASSEMBLY_REVISION_LIMIT } = await import("@/lib/pipeline/assembly-spec-record");
    const job = await db.job.create({ data: { inputRequest: "prune", scadSource: source, state: "DELIVERED" } });
    const context = { params: Promise.resolve({ id: job.id }) };
    let expected: string | null = null;
    for (let i = 0; i < ASSEMBLY_REVISION_LIMIT + 2; i++) {
      const response = await PUT(request("PUT", { spec: { ...spec, unknowns: [`edit ${i}`] }, sourceSha256: hash, expectedSpecSha256: expected }), context);
      expect(response.status).toBe(200);
      expected = (await response.json()).specSha256;
    }
    const history = await (await getRevisions(request("GET"), context)).json();
    expect(history.revisions).toHaveLength(ASSEMBLY_REVISION_LIMIT);
    expect(history.revisions[0].revision).toBe(ASSEMBLY_REVISION_LIMIT + 2);
    expect(history.revisions[0].spec.unknowns).toEqual([`edit ${ASSEMBLY_REVISION_LIMIT + 1}`]);
    expect(history.revisions.at(-1).spec.unknowns).toEqual(["edit 2"]);
  });
}
