import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_BUNDLE_ROUTE_CHILD !== "1") {
  test("assembly bundle route archives every part and refuses ambiguous selectors", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-bundle-route-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const fake = path.join(dir, "openscad");
    // Different selectors must produce different bytes, otherwise the identity
    // guard would (correctly) refuse the bundle and hide the success path.
    // Closed boxes rather than one triangle: a real removal path needs surfaces
    // to collide with, and a degenerate triangle would pass every clearance test.
    writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
const partArg = args.find((value, index) => args[index - 1] === '-D' && value.startsWith('agentscad_part='));
const part = partArg ? partArg.replace('agentscad_part=', '').replace(/["']/g, '') : 'all';
if (part !== 'all' && !args.includes('agentscad_pose=false')) process.exit(2);
const ignore = fs.readFileSync(args[args.length - 1], 'utf8').includes('IGNORE_SELECTOR');
const size = ignore ? [1, 1, 1] : part === 'lid' ? [4, 4, 4] : part === 'all' ? [10, 10, 4] : [10, 10, 2];
const [x, y, z] = size;
const p = (dx, dy, dz) => [dx, dy, dz];
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
const triangles = [
  ...quad(p(0,0,0), p(0,y,0), p(x,y,0), p(x,0,0)),
  ...quad(p(0,0,z), p(x,0,z), p(x,y,z), p(0,y,z)),
  ...quad(p(0,0,0), p(x,0,0), p(x,0,z), p(0,0,z)),
  ...quad(p(x,0,0), p(x,y,0), p(x,y,z), p(x,0,z)),
  ...quad(p(x,y,0), p(0,y,0), p(0,y,z), p(x,y,z)),
  ...quad(p(0,y,0), p(0,0,0), p(0,0,z), p(0,y,z)),
];
const buffer = Buffer.alloc(84 + 50 * triangles.length);
buffer.writeUInt32LE(triangles.length, 80);
triangles.forEach((triangle, index) => {
  const start = 84 + 50 * index + 12;
  triangle.forEach((vertex, v) => vertex.forEach((value, k) => buffer.writeFloatLE(value, start + v * 12 + k * 4)));
});
fs.writeFileSync(out, buffer);
`, { mode: 0o755 });
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_BUNDLE_ROUTE_CHILD: "1", API_SECRET: "bundle-test-secret", OPENSCAD_BIN: fake, AGENTSCAD_OPENSCAD_BACKEND: "native" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 40000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
} else {
  const { unzipSync, strFromU8 } = await import("fflate");
  const { db } = await import("@/lib/db");
  const { PUT } = await import("@/app/api/jobs/[id]/assembly/route");
  const { GET } = await import("@/app/api/jobs/[id]/assembly/bundle/route");
  const { GET: GET_LAYOUT } = await import("@/app/api/jobs/[id]/assembly/layout/route");
  const { GET: GET_EVIDENCE } = await import("@/app/api/jobs/[id]/assembly/evidence/route");
  const { POST: POST_SOURCE_POSES } = await import("@/app/api/jobs/[id]/assembly/source-poses/route");
  const { POST: POST_ASSEMBLY_REPAIR, GET: GET_ASSEMBLY_REPAIR } = await import("@/app/api/jobs/[id]/assembly/repair/route");
  const { ASSEMBLY_REPAIR_LEDGER_FIELD, createRepairEvent, appendRepairEvent } = await import("@/lib/assembly/repair-ledger");
  const { GET: GET_SNAPSHOTS, POST: POST_SNAPSHOT } = await import("@/app/api/jobs/[id]/assembly/evidence/snapshots/route");
  const { ASSEMBLY_EVIDENCE_FIELD } = await import("@/lib/assembly/evidence-snapshot-record");
  const { readBinaryStl, meshBounds } = await import("@/lib/geometry/stl-mesh");
  const { assemblySpecificationHash } = await import("@/lib/pipeline/assembly-spec-record");
  const { AssemblySpecSchema } = await import("@/lib/assembly/assembly-spec");
  const { readRequirementContract, saveRequirementContract, requirementRecordId } = await import("@/lib/requirements/requirement-contract-record");
  const { lockAssemblyExport } = await import("@/lib/pipeline/assembly-export-guard");
  afterAll(async () => db.$disconnect());

  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const source = 'agentscad_part = "all"; if (agentscad_part == "base") cube(1); if (agentscad_part == "lid") cube(2);';
  const hash = createHash("sha256").update(source).digest("hex");
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "base", name: "Base", selector: "base", source: "generated", material: null },
      { id: "lid", name: "Lid", selector: "lid", source: "generated", material: null },
      { id: "screw", name: "Screw", selector: "screw", source: "purchased", material: "steel" },
    ],
    instances: [
      { id: "base1", partId: "base", subassemblyId: null, transform: pose },
      { id: "lid1", partId: "lid", subassemblyId: null, transform: pose },
      { id: "screw1", partId: "screw", subassemblyId: null, transform: pose },
    ],
    subassemblies: [], connections: [], groundedInstanceId: "base1", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const specHash = assemblySpecificationHash(AssemblySpecSchema.parse(spec));
  const admin = (url: string, method = "GET", body?: unknown) => new Request(url, { method, headers: { authorization: "Bearer bundle-test-secret", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const url = (h = hash, sh = specHash) => `http://localhost/api?sourceSha256=${h}&specSha256=${sh}`;
  async function create(scadSource = source, contract: unknown = spec) {
    const job = await db.job.create({ data: { inputRequest: "test", state: "DELIVERED", scadSource, completedAt: new Date("2020-01-01T00:00:00Z") } });
    const sourceHash = createHash("sha256").update(scadSource).digest("hex");
    const saved = await PUT(admin("http://localhost", "PUT", { spec: contract, sourceSha256: sourceHash, expectedSpecSha256: null }), { params: Promise.resolve({ id: job.id }) });
    expect(saved.status).toBe(200);
    return { job: await db.job.findUniqueOrThrow({ where: { id: job.id } }), sourceHash, specHash: assemblySpecificationHash(AssemblySpecSchema.parse(contract)) };
  }

  test("returns one archive with a manifest that binds the exact parts", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const response = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("X-AgentSCAD-Part-Count")).toBe("2");
    expect(response.headers.get("X-AgentSCAD-Verification")).toContain("identity=NOT_RUN");
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["README.txt", "base.stl", "lid.stl", "manifest.json", "specification.json"]);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    // The canonical declaration travels with the archive and is bound by hash.
    expect(createHash("sha256").update(Buffer.from(entries["specification.json"])).digest("hex")).toBe(manifest.specificationSha256);
    expect(manifest.sourceSha256).toBe(sourceHash);
    const requirements = await readRequirementContract(job.id, job.inputRequest);
    expect(manifest.contract.binding.sha256).toBe(requirements.contractSha256);
    expect(manifest.contract.evidenceCurrent).toBe(false);
    expect(response.headers.get("X-AgentSCAD-Contract-Current")).toBe("false");
    expect(manifest.parts.map((part: { id: string }) => part.id)).toEqual(["base", "lid", "screw"]);
    expect(manifest.parts[0].artifactSha256).toBe(createHash("sha256").update(Buffer.from(entries["base.stl"])).digest("hex"));
    expect(manifest.parts[0].artifactSha256).not.toBe(manifest.parts[1].artifactSha256);
    expect(manifest.parts[2]).toMatchObject({ id: "screw", source: "purchased", fileName: null });
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("records a deliberate bundle export against the matching artifact version", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const version = await db.jobArtifactVersion.create({ data: { jobId: job.id, scadSource: source, scadHash: sourceHash, createdAt: new Date("2020-01-01") } });
    const response = await GET(admin(`${url(sourceHash, contractHash)}&download=1`), context(job.id));
    expect(response.status).toBe(200);
    const outcomes = await db.jobOutcome.findMany({ where: { jobId: job.id } });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("exported");
    expect(outcomes[0].artifactVersionId).toBe(version.id);
    const detail = JSON.parse(outcomes[0].detail!);
    expect(detail.artifact).toBe("assembly_bundle");
    expect(detail.partCount).toBe(2);
    expect(detail.bundleSha256).toBe(response.headers.get("X-AgentSCAD-Bundle-SHA256"));
    expect(detail.contract.binding.sha256).toBe(response.headers.get("X-AgentSCAD-Contract-SHA256"));
  });

  test("layout endpoint reconstructs a complete placed assembly without asserting fit", async () => {
    const elevated = [...pose];
    elevated[11] = 3;
    const complete = {
      ...spec, parts: spec.parts.filter(part => part.source === "generated"),
      instances: [spec.instances[0], { ...spec.instances[1], transform: elevated }],
    };
    const { job, sourceHash, specHash: contractHash } = await create(source, complete);
    const version = await db.jobArtifactVersion.create({
      data: { jobId: job.id, scadSource: source, scadHash: sourceHash },
    });
    const requestUrl = url(sourceHash, contractHash);
    const preview = await GET_LAYOUT(admin(requestUrl), context(job.id));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("model/stl");
    expect(preview.headers.get("X-AgentSCAD-Layout-Status")).toBe("COMPLETE");
    expect(preview.headers.get("X-AgentSCAD-Reference-Status")).toBe("NOT_RUN");
    expect(preview.headers.get("X-AgentSCAD-Contract-Current")).toBe("false");
    expect(preview.headers.get("X-AgentSCAD-Instance-Count")).toBe("2");
    const stl = Buffer.from(await preview.arrayBuffer());
    expect(readBinaryStl(stl).triangleCount).toBe(24);
    expect(meshBounds(readBinaryStl(stl))).toEqual({ min: [0, 0, 0], max: [10, 10, 7] });
    expect(preview.headers.get("X-AgentSCAD-Layout-SHA256")).toBe(createHash("sha256").update(stl).digest("hex"));
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
    const downloaded = await GET_LAYOUT(admin(requestUrl + "&download=1"), context(job.id));
    expect(downloaded.status).toBe(200);
    const outcomes = await db.jobOutcome.findMany({ where: { jobId: job.id } });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("exported");
    expect(outcomes[0].artifactVersionId).toBe(version.id);
    expect(JSON.parse(outcomes[0].detail!).artifact).toBe("assembly_layout");
    expect(JSON.parse(outcomes[0].detail!).referenceStatus).toBe("NOT_RUN");
  });

  test("layout export never invents geometry for purchased parts or export a partial assembly", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const response = await GET_LAYOUT(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("purchased parts");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
    const purchasedOnly = {
      ...spec, parts: spec.parts.filter(part => part.source === "purchased"),
      instances: spec.instances.filter(instance => instance.partId === "screw"),
      groundedInstanceId: "screw1",
    };
    const only = await create(source, purchasedOnly);
    expect((await GET_LAYOUT(admin(url(only.sourceHash, only.specHash)), context(only.job.id))).status).toBe(422);
  });

  test("layout endpoint retains job-session, source and specification version guards", async () => {
    const complete = {
      ...spec, parts: spec.parts.filter(part => part.source === "generated"),
      instances: spec.instances.filter(instance => instance.partId !== "screw"),
    };
    const { job, sourceHash, specHash: contractHash } = await create(source, complete);
    expect((await GET_LAYOUT(new Request(url(sourceHash, contractHash)) as never, context(job.id))).status).toBe(401);
    expect((await GET_LAYOUT(admin(url("0".repeat(64), contractHash)), context(job.id))).status).toBe(409);
    expect((await GET_LAYOUT(admin(url(sourceHash, "0".repeat(64))), context(job.id))).status).toBe(409);
    expect((await GET_LAYOUT(admin("http://localhost/api?sourceSha256=" + sourceHash), context(job.id))).status).toBe(400);
    await db.job.update({ where: { id: job.id }, data: { scadSource: source + "// updated" } });
    expect((await GET_LAYOUT(admin(url(sourceHash, contractHash)), context(job.id))).status).toBe(409);
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("server confirmation is bound into the bundle; changing the request invalidates it", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const derived = await readRequirementContract(job.id, job.inputRequest);
    const confirmed = await saveRequirementContract({ job, contract: derived.contract, expectedContractSha256: null });
    const response = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(200);
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.contract.evidenceCurrent).toBe(true);
    expect(manifest.contract.binding).toMatchObject({ sha256: confirmed.contractSha256, revision: confirmed.revision, requestMatches: true });
    expect(strFromU8(entries["README.txt"])).toContain(confirmed.contractSha256);
    expect(manifest.evidence.motion.status).toBe("NOT_RUN");
    await db.job.update({ where: { id: job.id }, data: { inputRequest: "a different assembly request" } });
    const stale = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(stale.status).toBe(200);
    expect(stale.headers.get("X-AgentSCAD-Contract-Current")).toBe("false");
    expect(stale.headers.get("X-AgentSCAD-Contract-SHA256")).not.toBe(confirmed.contractSha256);
  });

  test("on-demand evidence is a hash-bound read with no acceptance or export event", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const response = await GET_EVIDENCE(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const report = await response.json();
    expect(report.reportSchemaVersion).toBe(1);
    expect(report.sourceSha256).toBe(sourceHash);
    expect(report.specificationSha256).toBe(contractHash);
    expect(report.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.contract.evidenceCurrent).toBe(false);
    expect(report.disassembly.status).toBe("NOT_RUN");
    expect(report.disassembly.measuredStatus).toBe("NOT_RUN");
    expect(report.disassembly.totalOperations).toBe(0);
    expect(report.evidence.physical.status).toBe("NOT_RUN");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
    expect((await GET_EVIDENCE(new Request(url(sourceHash, contractHash)) as never, context(job.id))).status).toBe(401);
    expect((await GET_EVIDENCE(admin(url("0".repeat(64), contractHash)), context(job.id))).status).toBe(409);
    expect((await GET_EVIDENCE(admin(url(sourceHash, "0".repeat(64))), context(job.id))).status).toBe(409);
  });

  test("evidence exposes raw sampled PASS separately from unconfirmed gated NOT_RUN", async () => {
    const lift = [...pose]; lift[11] = 2.5;
    const end = [...pose]; end[11] = 22.5;
    const removable = {
      ...spec,
      parts: spec.parts.filter(part => part.source !== "purchased"),
      instances: [spec.instances[0], { ...spec.instances[1], transform: lift }],
      operations: [{ id: "remove_lid", action: "disassemble", instanceId: "lid1", tools: [], waypoints: [lift, end] }],
    };
    const { job, sourceHash, specHash: contractHash } = await create(source, removable);
    const first = await GET_EVIDENCE(admin(url(sourceHash, contractHash)), context(job.id));
    expect(first.status).toBe(200);
    const unconfirmed = await first.json();
    expect(unconfirmed.contract.evidenceCurrent).toBe(false);
    expect(unconfirmed.disassembly.status).toBe("NOT_RUN");
    expect(unconfirmed.disassembly.measuredStatus).toBe("PASS");
    expect(unconfirmed.evidence.disassembly.status).toBe("NOT_RUN");
    expect(unconfirmed.disassembly.operations).toHaveLength(1);
    expect(unconfirmed.disassembly.operations[0].path.posesEvaluated).toBeGreaterThan(2);
    expect(unconfirmed.disassembly.operations[0].path.declaredPoseCount).toBeGreaterThan(2);
    expect(unconfirmed.disassembly.operations[0].path.blockedAt).toBeNull();

    const derived = await readRequirementContract(job.id, job.inputRequest);
    await saveRequirementContract({ job, contract: derived.contract, expectedContractSha256: null });
    const second = await GET_EVIDENCE(admin(url(sourceHash, contractHash)), context(job.id));
    expect(second.status).toBe(200);
    const confirmed = await second.json();
    expect(confirmed.contract.evidenceCurrent).toBe(true);
    expect(confirmed.disassembly.status).toBe("PASS");
    expect(confirmed.disassembly.measuredStatus).toBe("PASS");
    expect(confirmed.evidence.physical.status).toBe("NOT_RUN");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("failed initial pose is a measured FAIL and reports blocking instance, not a guessed PASS", async () => {
    const end = [...pose]; end[11] = 20;
    const blocked = {
      ...spec,
      parts: spec.parts.filter(part => part.source !== "purchased"),
      instances: [spec.instances[0], spec.instances[1]],
      operations: [{ id: "remove_lid", action: "disassemble", instanceId: "lid1", tools: [], waypoints: [pose, end] }],
    };
    const { job, sourceHash, specHash: contractHash } = await create(source, blocked);
    const response = await GET_EVIDENCE(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.contract.evidenceCurrent).toBe(false);
    expect(result.disassembly.measuredStatus).toBe("FAIL");
    expect(result.disassembly.status).toBe("FAIL");
    expect(result.disassembly.operations[0].path.blockedAt.poseIndex).toBe(0);
    expect(result.disassembly.operations[0].path.blockedAt.obstacleId).toBe("base1");
    const replay = result.disassembly.operations[0].path.blockedAt.replayFrame;
    expect(replay.frame).toBe("right-handed-mm-row-major-4x4/v1");
    expect(replay.movingWorldFromLocal).toEqual(pose);
    expect(replay.obstacleWorldFromLocal).toEqual(pose);
    expect(replay.movingMeshSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(replay.obstacleMeshSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(replay.movingMeshSha256).not.toBe(replay.obstacleMeshSha256);
    expect(result.disassembly.operations[0].path.testedTrianglePairs).toBeGreaterThanOrEqual(0);
    expect(result.disassembly.operations[0].path.blockedAt.testedPairs).toBeGreaterThanOrEqual(0);
    expect(result.disassembly.operations[0].path.blockedAt.collisionReason).toBeTruthy();
    const witness = result.disassembly.operations[0].path.blockedAt;
    if (witness.trianglePair) {
      expect(witness.trianglePair.movingTriangleIndex).toBeGreaterThanOrEqual(0);
      expect(witness.trianglePair.obstacleTriangleIndex).toBeGreaterThanOrEqual(0);
    }
    if (witness.witnessCentroidPointMm) {
      expect(witness.witnessCentroidPointMm).toHaveLength(3);
      expect(witness.witnessCentroidPointMm.every(Number.isFinite)).toBe(true);
    }
    // No "exact contact coordinate" or penetration depth is invented.
    expect(result.limitations.join(" ")).toContain("midpoint");
  });

  test("user-triggered snapshot saves real server measurement, never a supplied PASS", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const target = url(sourceHash, contractHash);
    expect((await GET_SNAPSHOTS(new Request(target) as never, context(job.id))).status).toBe(401);
    expect((await POST_SNAPSHOT(new Request(target, { method: "POST" }) as never, context(job.id))).status).toBe(401);
    expect((await POST_SNAPSHOT(admin(url("0".repeat(64), contractHash), "POST"), context(job.id))).status).toBe(409);
    const response = await POST_SNAPSHOT(admin(target, "POST", {
      evidence: { physical: { status: "PASS" } }, report: { reportSchemaVersion: 1 },
    }), context(job.id));
    expect(response.status).toBe(201);
    const stored = await response.json();
    expect(stored.integrity).toBe("PASS");
    expect(stored.snapshot.report.sourceSha256).toBe(sourceHash);
    expect(stored.snapshot.report.specificationSha256).toBe(contractHash);
    expect(stored.snapshot.report.evidence.physical.status).toBe("NOT_RUN");
    expect(stored.snapshot.report.disassembly.measuredStatus).toBe("NOT_RUN");
    expect(stored.snapshot.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    const history = await GET_SNAPSHOTS(admin(target), context(job.id));
    expect(history.status).toBe(200);
    expect(history.headers.get("Cache-Control")).toBe("no-store");
    const list = (await history.json()).snapshots;
    expect(list).toHaveLength(1);
    expect(list[0].integrity).toBe("PASS");
    expect(list[0].bindingCurrent).toBe(true);
    expect(list[0].snapshot.snapshotSha256).toBe(stored.snapshot.snapshotSha256);
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("saved evidence is immutable; same hash with a new confirmation becomes history", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const target = url(sourceHash, contractHash);
    const first = await POST_SNAPSHOT(admin(target, "POST"), context(job.id));
    const second = await POST_SNAPSHOT(admin(target, "POST"), context(job.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await first.json()).id).not.toBe((await second.json()).id);
    expect(await db.jobVersion.count({ where: { jobId: job.id, field: ASSEMBLY_EVIDENCE_FIELD } })).toBe(2);
    const derived = await readRequirementContract(job.id, job.inputRequest);
    await saveRequirementContract({ job, contract: derived.contract, expectedContractSha256: null });
    const afterConfirmation = await GET_SNAPSHOTS(admin(target), context(job.id));
    const rows = (await afterConfirmation.json()).snapshots;
    expect(rows).toHaveLength(2);
    expect(rows.every((row: { bindingCurrent: boolean }) => row.bindingCurrent === false)).toBe(true);
    expect(rows[0].reasons).toContain("Requirement confirmation changed");
    expect(rows[0].snapshot.report.evidence.disassembly.status).toBe("NOT_RUN");
    await db.job.update({ where: { id: job.id }, data: { scadSource: source + "\n// new version" } });
    const afterSourceChange = await GET_SNAPSHOTS(admin(target), context(job.id));
    const stale = (await afterSourceChange.json()).snapshots;
    expect(stale[0].bindingCurrent).toBe(false);
    expect(stale[0].reasons).toContain("Source geometry changed");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("corrupt stored record is returned as ERROR and cannot be promoted", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const response = await POST_SNAPSHOT(admin(url(sourceHash, contractHash), "POST"), context(job.id));
    expect(response.status).toBe(201);
    const saved = await response.json();
    const row = await db.jobVersion.findUniqueOrThrow({ where: { id: saved.id } });
    const payload = JSON.parse(row.newValue!);
    payload.report.evidence.physical.status = "PASS";
    await db.jobVersion.update({ where: { id: row.id }, data: { newValue: JSON.stringify(payload) } });
    const history = await GET_SNAPSHOTS(admin(url(sourceHash, contractHash)), context(job.id));
    const item = (await history.json()).snapshots[0];
    expect(item.integrity).toBe("ERROR");
    expect(item.bindingCurrent).toBe(false);
    expect(item.snapshot).toBeNull();
  });

  test("saved evidence history pages without losing or cross-reading job-scoped rows", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const saved = await POST_SNAPSHOT(admin(url(sourceHash, contractHash), "POST"), context(job.id));
    expect(saved.status).toBe(201);
    const first = await saved.json();
    for (let i = 0; i < 2; i++) {
      await db.jobVersion.create({
        data: {
          id: "synthetic-evidence:" + job.id + ":" + i, jobId: job.id, field: ASSEMBLY_EVIDENCE_FIELD,
          newValue: JSON.stringify(first.snapshot), changedBy: "system",
          createdAt: new Date("2026-11-13T12:00:0" + i + ".000Z"),
        },
      });
    }
    const query = url(sourceHash, contractHash) + "&limit=1";
    const page1 = await GET_SNAPSHOTS(admin(query), context(job.id));
    expect(page1.status).toBe(200);
    const result1 = await page1.json();
    expect(result1.snapshots).toHaveLength(1);
    expect(result1.nextCursor).toBeTruthy();
    const page2 = await GET_SNAPSHOTS(admin(query + "&cursor=" + encodeURIComponent(result1.nextCursor)), context(job.id));
    expect(page2.status).toBe(200);
    const result2 = await page2.json();
    expect(result2.snapshots).toHaveLength(1);
    expect(result2.snapshots[0].id).not.toBe(result1.snapshots[0].id);
    const otherJob = await create();
    const outside = await GET_SNAPSHOTS(admin(query + "&cursor=assembly-evidence:" + otherJob.job.id), context(job.id));
    expect(outside.status).toBe(400);
  });

  test("a real removal path is exported as a gated verdict instead of a raw pass", async () => {
    const lift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2.5, 0, 0, 0, 1];
    const end = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 22.5, 0, 0, 0, 1];
    const removable = {
      ...spec,
      parts: spec.parts.filter((part) => part.id !== "screw"),
      instances: [spec.instances[0], { id: "lid1", partId: "lid", subassemblyId: null, transform: lift }],
      operations: [{ id: "remove_lid", action: "disassemble", instanceId: "lid1", tools: [], waypoints: [lift, end] }],
    };
    const { job, sourceHash, specHash: contractHash } = await create(source, removable);

    const unconfirmed = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(unconfirmed.status).toBe(200);
    expect(unconfirmed.headers.get("X-AgentSCAD-Verification")).toContain("disassembly=NOT_RUN");
    const first = JSON.parse(strFromU8(unzipSync(new Uint8Array(await unconfirmed.arrayBuffer()))["manifest.json"]));
    expect(first.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(first.declaredDisassembly.status).toBe("NOT_RUN");

    const derived = await readRequirementContract(job.id, job.inputRequest);
    await saveRequirementContract({ job, contract: derived.contract, expectedContractSha256: null });
    const confirmed = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get("X-AgentSCAD-Verification")).toContain("disassembly=PASS");
    const second = JSON.parse(strFromU8(unzipSync(new Uint8Array(await confirmed.arrayBuffer()))["manifest.json"]));
    expect(second.declaredDisassembly.measuredStatus).toBe("PASS");
    expect(second.declaredDisassembly.status).toBe("PASS");
  });

  test("the export lease refuses request changes and same-content confirmation revisions", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    const derived = await readRequirementContract(job.id, job.inputRequest);
    await saveRequirementContract({ job, contract: derived.contract, expectedContractSha256: null });
    const lease = await lockAssemblyExport({ request: admin(url()), jobId: job.id, sourceSha256: sourceHash, specSha256: contractHash });
    try {
      const row = await db.jobVersion.findUniqueOrThrow({ where: { id: requirementRecordId(job.id) } });
      const payload = JSON.parse(row.newValue!);
      // Simulate an out-of-band writer bypassing the normal mutation lock.
      payload.revision += 1;
      payload.contract.revision += 1;
      await db.jobVersion.update({ where: { id: row.id }, data: { newValue: JSON.stringify(payload) } });
      await expect(lease.verifyUnchanged()).rejects.toThrow("Requirement contract changed");
    } finally { await lease.stop(); }
    const next = await lockAssemblyExport({ request: admin(url()), jobId: job.id, sourceSha256: sourceHash, specSha256: contractHash });
    try {
      await db.job.update({ where: { id: job.id }, data: { inputRequest: "changed during rendering" } });
      await expect(next.verifyUnchanged()).rejects.toThrow("Job changed");
    } finally { await next.stop(); }
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("refuses a bundle whose selectors do not isolate parts", async () => {
    const ignoring = `${source}\n// IGNORE_SELECTOR`;
    const { job, sourceHash, specHash: contractHash } = await create(ignoring);
    const response = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("not independently selectable");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("refuses an assembly with no generated parts", async () => {
    const purchasedOnly = { ...spec, parts: [{ id: "screw", name: "Screw", selector: "screw", source: "purchased", material: null }], instances: [{ id: "screw1", partId: "screw", subassemblyId: null, transform: pose }], groundedInstanceId: "screw1" };
    const { job, sourceHash, specHash: contractHash } = await create(source, purchasedOnly);
    const response = await GET(admin(url(sourceHash, contractHash)), context(job.id));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("no generated parts");
  });

  test("explicit source pose API runs only for a real current authorized job and never approves motion", async () => {
    const hingeSource = source + "\nhinge_angle = 0;\n";
    const fixture = {
      ...spec, parts: spec.parts.filter(part => part.source !== "purchased"),
      instances: spec.instances.filter(instance => instance.partId !== "screw"),
      connections: [{
        id: "hinge", type: "revolute", a: "base1", b: "lid1",
        frameA: { origin: [0,0,0], direction: [0,0,1] },
        frameB: { origin: [0,0,0], direction: [0,0,1] },
        range: { min: -15, max: 15, unit: "deg" },
        pitchMm: null, ratio: null, allowedContact: [],
      }],
    };
    const { job, sourceHash, specHash: currentSpecHash } = await create(hingeSource, fixture);
    const params = {
      sourceSha256: sourceHash, specSha256: currentSpecHash,
      connectionId: "hinge", sourceParameter: "hinge_angle",
      rotationDeg: 10, confirmedBinding: true,
    };
    const endpoint = "http://localhost/api/jobs/" + job.id + "/assembly/source-poses";
    const response = await POST_SOURCE_POSES(admin(endpoint, "POST", params), context(job.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    expect(data.schemaVersion).toBe(1);
    expect(data.sourceSha256).toBe(sourceHash);
    expect(data.specSha256).toBe(currentSpecHash);
    expect(data.binding.movingInstanceId).toBe("lid1");
    expect(data.binding.sourceParameter).toBe("hinge_angle");
    expect(data.binding.independentParameterSemanticsVerified).toBe(false);
    expect(data.bindingSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.checkerVersion).toBe("source-pose-observer/v2+bounded-rigid-axis-swept-aabb/v1");
    expect(data.rendererBackend).toBe("native");
    expect(data.report.samples).toHaveLength(3);
    expect(data.report.samples.map((row: {id: string}) => row.id)).toEqual(["negative", "zero", "positive"]);
    const dense = await POST_SOURCE_POSES(admin(endpoint, "POST", { ...params, sampleCount: 5 }), context(job.id));
    expect(dense.status).toBe(200);
    const denseReport = await dense.json();
    expect(denseReport.binding.sampleCount).toBe(5);
    expect(denseReport.binding.maximumSampleAngleGapDeg).toBe(5);
    expect(denseReport.report.samples).toHaveLength(5);
    expect(denseReport.productMotionApproval).toBe("NOT_RUN");
    expect(denseReport.physicalFunctionApproval).toBe("NOT_RUN");
    expect(denseReport.report.analyticRigidSweep.method).toBe("bounded-rigid-axis-swept-aabb/v1");

    expect(data.report.samples.every((row: {referenceStlSha256: string}) => /^[a-f0-9]{64}$/.test(row.referenceStlSha256))).toBe(true);
    expect(data.productMotionApproval).toBe("NOT_RUN");
    expect(data.physicalFunctionApproval).toBe("NOT_RUN");
    expect(await db.jobOutcome.count({ where: { jobId: job.id } })).toBe(0);
    expect(await db.jobVersion.count({ where: { jobId: job.id, field: ASSEMBLY_EVIDENCE_FIELD } })).toBe(0);

    const unauth = await POST_SOURCE_POSES(new Request(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    }) as never, context(job.id));
    expect(unauth.status).toBe(401);
    const invalid = await POST_SOURCE_POSES(admin(endpoint, "POST", { ...params, confirmedBinding: false }), context(job.id));
    expect(invalid.status).toBe(422);
    const stale = await POST_SOURCE_POSES(admin(endpoint, "POST", { ...params, sourceSha256: "f".repeat(64) }), context(job.id));
    expect(stale.status).toBe(409);
    const foreign = await POST_SOURCE_POSES(admin(endpoint, "POST", params), context("nonexistent-job"));
    expect(foreign.status).toBe(404);
  }, 60000);

  test("A07 refuses unauthorized, stale, unconfirmed or non-opted-in paid repair without invoking a model", async () => {
    const {job,sourceHash,specHash:currentSpecHash}=await create();
    const endpoint="http://localhost/api/jobs/"+job.id+"/assembly/repair";
    const payload={
      sourceSha256:sourceHash,specSha256:currentSpecHash,
      confirmedPaidModelCalls:true,maxAttempts:1,
    };
    const unauthorized=await POST_ASSEMBLY_REPAIR(new Request(endpoint,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(payload),
    }) as never,context(job.id));
    expect(unauthorized.status).toBe(401);
    const malformed=await POST_ASSEMBLY_REPAIR(admin(endpoint,"POST",{...payload,confirmedPaidModelCalls:false}),context(job.id));
    expect(malformed.status).toBe(422);
    const stale=await POST_ASSEMBLY_REPAIR(admin(endpoint,"POST",{...payload,sourceSha256:"0".repeat(64)}),context(job.id));
    expect(stale.status).toBe(409);
    const unconfirmed=await POST_ASSEMBLY_REPAIR(admin(endpoint,"POST",payload),context(job.id));
    expect(unconfirmed.status).toBe(409);
    const unknown=await POST_ASSEMBLY_REPAIR(admin(endpoint,"POST",payload),context("nonexistent"));
    expect(unknown.status).toBe(404);
    const history=await GET_ASSEMBLY_REPAIR(admin(endpoint),context(job.id));
    expect(history.status).toBe(200);
    expect((await history.json()).events).toEqual([]);
    const historyUnauth=await GET_ASSEMBLY_REPAIR(new Request(endpoint) as never,context(job.id));
    expect(historyUnauth.status).toBe(401);
    expect(await db.jobVersion.count({where:{jobId:job.id,field:ASSEMBLY_REPAIR_LEDGER_FIELD}})).toBe(0);
    expect(await db.jobOutcome.count({where:{jobId:job.id}})).toBe(0);
  });

  test("A07 historical failed/aborted attempts survive and reject tampering, without a JobOutcome",async()=>{
    const {job,sourceHash,specHash:currentSpecHash}=await create();
    const requirements=await readRequirementContract(job.id,job.inputRequest);
    const {fingerprintRequirementState}=await import("@/lib/assembly/evidence-snapshot-record");
    const ctx={
      jobId:job.id,runId:"00000000-0000-4000-8000-000000000001",
      sourceSha256:sourceHash,specificationSha256:currentSpecHash,
      contractSha256:requirements.contractSha256,
      requirementFingerprint:fingerprintRequirementState(requirements),
    };
    const event=createRepairEvent({...ctx,eventIndex:0,state:"ABORTED",terminal:{
      stoppedBecause:"aborted",reason:"Lease cancelled during model call",
      finalScadSha256:sourceHash,evidenceComplete:false,reviewCandidateScad:null,
    }});
    const stored=await appendRepairEvent(event);
    const history=await GET_ASSEMBLY_REPAIR(admin("http://localhost"),context(job.id));
    const events=(await history.json()).events;
    expect(events).toHaveLength(1);
    expect(events[0].integrity).toBe("PASS");
    expect(events[0].bindingCurrent).toBe(true);
    expect(events[0].event.terminal.stoppedBecause).toBe("aborted");
    await db.jobVersion.update({where:{id:stored.id},data:{newValue:JSON.stringify({...event,eventSha256:"f".repeat(64)})}});
    const altered=await GET_ASSEMBLY_REPAIR(admin("http://localhost"),context(job.id));
    const broken=(await altered.json()).events;
    expect(broken[0].integrity).toBe("ERROR");
    expect(broken[0].bindingCurrent).toBe(false);
    expect(await db.jobOutcome.count({where:{jobId:job.id}})).toBe(0);
    expect((await db.job.findUniqueOrThrow({where:{id:job.id}})).scadSource).toBe(source);
  });

  test("A07 paid failed proposal history stores replayable exact source but redacts it after the Job source changes",async()=>{
    const {job,sourceHash,specHash:currentSpecHash}=await create();
    const requirements=await readRequirementContract(job.id,job.inputRequest);
    const {fingerprintRequirementState}=await import("@/lib/assembly/evidence-snapshot-record");
    const candidate="cube(2); // rejected candidate";
    const candidateSha=createHash("sha256").update(candidate).digest("hex");
    const event=createRepairEvent({
      jobId:job.id,runId:"00000000-0000-4000-8000-000000000002",
      sourceSha256:sourceHash,specificationSha256:currentSpecHash,
      contractSha256:requirements.contractSha256,
      requirementFingerprint:fingerprintRequirementState(requirements),
      eventIndex:1,state:"ATTEMPT",attempt:{
        attempt:1,scadSha256:candidateSha,candidateScadSource:candidate,
        candidateByteLength:Buffer.byteLength(candidate,"utf8"),
        findings:[],evidence:{identity:"PASS",assembly:"FAIL",motion:"NOT_RUN"},
        violations:[],accepted:false,phase:"measurement-error",reason:"Native OpenSCAD could not render",
      },
    });
    await appendRepairEvent(event);
    const current=await GET_ASSEMBLY_REPAIR(admin("http://localhost"),context(job.id));
    const now=(await current.json()).events;
    expect(now[0].integrity).toBe("PASS");
    expect(now[0].bindingCurrent).toBe(true);
    expect(now[0].event.attempt.candidateScadSource).toBe(candidate);
    expect(now[0].event.attempt.candidateByteLength).toBe(Buffer.byteLength(candidate,"utf8"));
    expect(now[0].event.attempt.scadSha256).toBe(candidateSha);
    // A source change makes the replay text stale: digest, byte count, phase and
    // reason survive, but the exact proposal bytes must not be served.
    await db.job.update({where:{id:job.id},data:{scadSource:source+"\n// changed"}});
    const stale=await GET_ASSEMBLY_REPAIR(admin("http://localhost"),context(job.id));
    const old=(await stale.json()).events;
    expect(old[0].integrity).toBe("PASS");
    expect(old[0].bindingCurrent).toBe(false);
    expect(old[0].event.attempt.candidateScadSource).toBeUndefined();
    expect(old[0].event.attempt.candidateByteLength).toBe(Buffer.byteLength(candidate,"utf8"));
    expect(old[0].event.attempt.scadSha256).toBe(candidateSha);
    expect(old[0].event.attempt.phase).toBe("measurement-error");
    expect(old[0].event.attempt.reason).toContain("could not render");
    expect(await db.jobOutcome.count({where:{jobId:job.id}})).toBe(0);
  });

  test("rejects missing authorization, stale hashes and unknown jobs", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    expect((await GET(new Request(url(sourceHash, contractHash)) as never, context(job.id))).status).toBe(401);
    expect((await GET(admin(url("0".repeat(64), contractHash)), context(job.id))).status).toBe(409);
    expect((await GET(admin(url(sourceHash, "0".repeat(64))), context(job.id))).status).toBe(409);
    expect((await GET(admin(`http://localhost/api?sourceSha256=${sourceHash}`), context(job.id))).status).toBe(400);
    expect((await GET(admin(url(sourceHash, contractHash)), context("missing"))).status).toBe(404);
  });

  test("a source change after saving makes the bundle stale", async () => {
    const { job, sourceHash, specHash: contractHash } = await create();
    await db.job.update({ where: { id: job.id }, data: { scadSource: `${source}\n// edited` } });
    expect((await GET(admin(url(sourceHash, contractHash)), context(job.id))).status).toBe(409);
  });
}
