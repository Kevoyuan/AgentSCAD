import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.AGENTSCAD_REQUIREMENTS_ROUTE_CHILD !== "1") {
  test("requirements route derives, confirms and expires a frozen contract", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentscad-requirements-route-"));
    writeFileSync(path.join(dir, "test.db"), "");
    const env = { ...process.env, DATABASE_URL: `file:${dir}/test.db`, AGENTSCAD_REQUIREMENTS_ROUTE_CHILD: "1", API_SECRET: "requirements-test-secret" };
    try {
      const setup = spawnSync("node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, encoding: "utf8", timeout: 20000 });
      expect(setup.status, setup.stdout + setup.stderr).toBe(0);
      const run = spawnSync(process.execPath, ["test", import.meta.path], { env, encoding: "utf8", timeout: 40000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
} else {
  const { db } = await import("@/lib/db");
  const { GET, PUT } = await import("@/app/api/jobs/[id]/requirements/route");
  const { axialRetentionCondition, setAxialRetention } = await import("@/lib/requirements/retention-input");
  afterAll(async () => db.$disconnect());

  const read = (authenticated = true) => new Request("http://localhost/api/jobs/x/requirements", {
    headers: authenticated ? { authorization: "Bearer requirements-test-secret" } : {},
  }) as never;
  const write = (body: unknown, authenticated = true) => new Request("http://localhost/api/jobs/x/requirements", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer requirements-test-secret" } : {}) },
    body: JSON.stringify(body),
  }) as never;
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const HINGE = "做一个两件式铰链，直径间隙 0.35 到 0.45 mm，能转 ±45°，可拆，3D 打印";

  test("a browser session is required", async () => {
    const job = await db.job.create({ data: { inputRequest: "两件式铰链，可拆" } });
    expect((await GET(read(false), context(job.id))).status).toBe(401);
    expect((await PUT(write({ contract: {}, expectedContractSha256: null }, false), context(job.id))).status).toBe(401);
  });

  test("an unknown job is not disclosed", async () => {
    expect((await GET(read(), context("missing-job"))).status).toBe(404);
    expect((await PUT(write({ contract: {}, expectedContractSha256: null }), context("missing-job"))).status).toBe(404);
  });

  test("the contract is derived from the original request and stays unconfirmed", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const body = await (await GET(read(), context(job.id))).json();
    expect(body.confirmed).toBe(false);
    expect(body.derivedFrom).toBe("inputRequest");
    expect(body.evidenceCurrent).toBe(false);
    expect(body.reason).toContain("has not been confirmed");
    expect(body.contract.intent.kind).toBe("revolute-hinge");
    expect(body.contract.requirements.map((item: { id: string }) => item.id)).toContain("disassembly-path");
    expect(body.contractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.derivedSha256).toBe(body.contractSha256);
    // Nothing is stored, so the value a client echoes back is null rather than the derived hash.
    expect(body.confirmedContractSha256).toBeNull();
  });

  test("the same request yields the same contract hash across jobs", async () => {
    const first = await db.job.create({ data: { inputRequest: "两件式铰链，可拆" } });
    const second = await db.job.create({ data: { inputRequest: "两件式铰链，可拆" } });
    const a = await (await GET(read(), context(first.id))).json();
    const b = await (await GET(read(), context(second.id))).json();
    expect(a.contractSha256).toBe(b.contractSha256);
  });

  test("a job without request text is refused instead of deriving an empty contract", async () => {
    const job = await db.job.create({ data: { inputRequest: "   " } });
    expect((await GET(read(), context(job.id))).status).toBe(409);
  });

  test("a malformed contract is rejected before anything is stored", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const response = await PUT(write({ contract: { schemaVersion: 1 }, expectedContractSha256: null }), context(job.id));
    expect(response.status).toBe(400);
    expect(await db.jobVersion.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("a contract for different request text cannot be confirmed", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const derived = (await (await GET(read(), context(job.id))).json()).contract;
    const forged = { ...derived, requestSha256: "0".repeat(64) };
    const response = await PUT(write({ contract: forged, expectedContractSha256: null }), context(job.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("different request text");
  });

  test("confirming stores a pointer, an append-only revision and makes evidence current", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const derived = (await (await GET(read(), context(job.id))).json()).contract;
    const response = await PUT(write({ contract: derived, expectedContractSha256: null }), context(job.id));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.confirmed).toBe(true);
    expect(saved.derived.requirements).toEqual(derived.requirements);
    expect(saved.derived.requestSha256).toBe(derived.requestSha256);
    expect(saved.derivedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.revision).toBe(1);
    expect(saved.edited).toBe(false);
    expect(saved.evidenceCurrent).toBe(true);
    expect(saved.contract.revision).toBe(1);
    expect(saved.confirmedContractSha256).toBe(saved.contractSha256);

    const reread = await (await GET(read(), context(job.id))).json();
    expect(reread.confirmed).toBe(true);
    expect(reread.derivedFrom).toBe("storedContract");
    expect(reread.evidenceCurrent).toBe(true);
    expect(reread.contractSha256).toBe(saved.contractSha256);
    expect(reread.stale).toBe(false);
    expect(await db.jobVersion.count({ where: { jobId: job.id, field: "__requirement_contract_revision" } })).toBe(1);
  });

  test("changing a confirmed retention condition invalidates A001 atomically without deleting prior evidence", async () => {
    const old = [{ rule_id: "A001", status: "FAIL", passed: false, message: "collision at 20°" },
      { rule_id: "C001", status: "PASS", passed: true, message: "compiled" }];
    const job = await db.job.create({ data: { inputRequest: HINGE, state: "HUMAN_REVIEW", validationResults: JSON.stringify(old),
      validationReportJson: '{"delivery":"previous"}', qualityScore: 100 } });
    const first = await (await GET(read(), context(job.id))).json();
    const confirmed = await (await PUT(write({ contract: first.contract, expectedContractSha256: null }), context(job.id))).json();
    const staleJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(staleJob.validationReportJson).toBeNull();expect(staleJob.qualityScore).toBeNull();
    let saved = JSON.parse(staleJob.validationResults!);
    expect(saved[0].status).toBe("NOT_RUN");
    expect(saved[0].staleAssemblyValidation.message).toBe("collision at 20°");
    expect(saved[1]).toEqual(old[1]);
    // An unchanged reconfirmation must not invalidate fresh results.
    const fresh = [{ rule_id: "A001", status: "PASS", passed: true, message: "new check" }, old[1]];
    await db.job.update({ where: { id: job.id }, data: { validationResults: JSON.stringify(fresh) } });
    expect((await PUT(write({ contract: confirmed.contract, expectedContractSha256: confirmed.contractSha256 }), context(job.id))).status).toBe(200);
    saved = JSON.parse((await db.job.findUniqueOrThrow({ where: { id: job.id } })).validationResults!);
    expect(saved[0].status).toBe("PASS");
    const condition = setAxialRetention(confirmed.contract, first.derived, { kind: "require", condition: "承受10N轴向拉力，按压后拆卸" });
    const response = await PUT(write({ contract: condition, expectedContractSha256: confirmed.contractSha256 }), context(job.id));
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.contract.requirements.find((item: { id: string }) => item.id === "axial-retention").statement).toContain("10N");
    saved = JSON.parse((await db.job.findUniqueOrThrow({ where: { id: job.id } })).validationResults!);
    expect(saved[0].status).toBe("NOT_RUN");
    expect(saved[0].staleAssemblyValidation.message).toBe("new check");
  });

  test("explicit retention survives normal confirmation and an old unresolved record can reuse the request", async () => {
    const request = HINGE + "。工作姿态必须有几何轴向防脱，并有明确几何约束阻止直接转到释放角。";
    const oldEvidence = [{ rule_id: "A001", status: "PASS", passed: true, message: "previous geometry" }];
    const job = await db.job.create({ data: { inputRequest: request, state: "HUMAN_REVIEW", validationResults: JSON.stringify(oldEvidence) } });
    const initial = await (await GET(read(), context(job.id))).json();
    const retention = initial.contract.requirements.find((item: { id: string }) => item.id === "axial-retention");
    expect(retention.provenance).toBe("request");
    expect(retention.statement).toContain("必须有几何轴向防脱");
    expect(initial.contract.unknowns.some((item: { id: string }) => item.id === "axial-retention")).toBe(false);

    const legacy = {
      ...initial.contract,
      requirements: initial.contract.requirements.filter((item: { id: string }) => item.id !== "axial-retention"),
      unknowns: [...initial.contract.unknowns, {
        id: "axial-retention", question: "轴向保持方式未说明：可抽离与自保持在功能上是不同合同。", affects: ["assembly", "motion"],
      }],
    };
    const payload = JSON.stringify({ contract: legacy, revision: 1, confirmedAt: new Date().toISOString() });
    const revisionId = `requirement-contract-rev:${job.id}:legacy`;
    await db.jobVersion.createMany({ data: [
      { id: `requirement-contract:${job.id}`, jobId: job.id, field: "__requirement_contract", newValue: payload },
      { id: revisionId, jobId: job.id, field: "__requirement_contract_revision", newValue: payload },
    ] });
    const stored = await (await GET(read(), context(job.id))).json();
    expect(stored.confirmed).toBe(true);
    expect(stored.contract.requirements.some((item: { id: string }) => item.id === "axial-retention")).toBe(false);
    expect(axialRetentionCondition(stored.contract, stored.derived)).toBe(retention.statement);
    const recovered = setAxialRetention(stored.contract, stored.derived, {
      kind: "require", condition: axialRetentionCondition(stored.contract, stored.derived),
    });
    const response = await PUT(write({ contract: recovered, expectedContractSha256: stored.confirmedContractSha256 }), context(job.id));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.revision).toBe(2);
    expect(saved.contract.requirements.find((item: { id: string }) => item.id === "axial-retention").provenance).toBe("request");
    expect(saved.contract.unknowns.some((item: { id: string }) => item.id === "axial-retention")).toBe(false);
    expect((await db.jobVersion.findUniqueOrThrow({ where: { id: revisionId } })).newValue).toBe(payload);
    const invalidated = JSON.parse((await db.job.findUniqueOrThrow({ where: { id: job.id } })).validationResults!);
    expect(invalidated[0].status).toBe("NOT_RUN");
    expect(invalidated[0].staleAssemblyValidation.message).toBe("previous geometry");

    const fresh = await db.job.create({ data: { inputRequest: request } });
    const first = await (await GET(read(), context(fresh.id))).json();
    const confirmed = await PUT(write({ contract: first.contract, expectedContractSha256: null }), context(fresh.id));
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).contract.requirements.find((item: { id: string }) => item.id === "axial-retention").provenance).toBe("request");
  });

  test("an edit is accepted, renumbered and marked confirmed provenance", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const first = (await (await GET(read(), context(job.id))).json());
    const confirmed = await (await PUT(write({ contract: first.contract, expectedContractSha256: null }), context(job.id))).json();

    const edited = {
      ...confirmed.contract,
      requirements: confirmed.contract.requirements.map((item: { id: string; expected: unknown }) =>
        item.id === "diametral-clearance" ? { ...item, expected: { kind: "range", min: 0.1, max: 0.3, unit: "mm" } } : item),
    };
    const response = await PUT(write({ contract: edited, expectedContractSha256: confirmed.contractSha256 }), context(job.id));
    expect(response.status).toBe(200);
    const second = await response.json();
    expect(second.revision).toBe(2);
    expect(second.edited).toBe(true);
    const clearance = second.contract.requirements.find((item: { id: string }) => item.id === "diametral-clearance");
    expect(clearance.expected).toEqual({ kind: "range", min: 0.1, max: 0.3, unit: "mm" });
    expect(clearance.provenance).toBe("confirmed");
    expect(second.contractSha256).not.toBe(confirmed.contractSha256);

    // The pointer follows the newest confirmation; the history keeps both.
    const history = await (await GET(new Request("http://localhost/api/jobs/x/requirements?history=1", { headers: { authorization: "Bearer requirements-test-secret" } }) as never, context(job.id))).json();
    expect(history.revisions.map((item: { revision: number }) => item.revision)).toEqual([2, 1]);
    expect(history.revisions[0].contractSha256).toBe(second.contractSha256);
  });

  test("a stale expected hash conflicts instead of overwriting a concurrent confirmation", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const derived = (await (await GET(read(), context(job.id))).json()).contract;
    expect((await PUT(write({ contract: derived, expectedContractSha256: null }), context(job.id))).status).toBe(200);
    // A second client still believes nothing is confirmed.
    const conflict = await PUT(write({ contract: derived, expectedContractSha256: null }), context(job.id));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toContain("changed");
    // It also cannot claim the wrong hash.
    expect((await PUT(write({ contract: derived, expectedContractSha256: "a".repeat(64) }), context(job.id))).status).toBe(409);
    expect(await db.jobVersion.count({ where: { jobId: job.id, field: "__requirement_contract_revision" } })).toBe(1);
  });

  test("removing a required assertion is refused", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const derived = (await (await GET(read(), context(job.id))).json()).contract;
    const truncated = { ...derived, requirements: derived.requirements.filter((item: { id: string }) => item.id !== "disassembly-path") };
    const response = await PUT(write({ contract: truncated, expectedContractSha256: null }), context(job.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("required by the request");
  });

  test("changing the request after confirmation makes the stored contract stale", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    const derived = (await (await GET(read(), context(job.id))).json()).contract;
    const confirmed = await (await PUT(write({ contract: derived, expectedContractSha256: null }), context(job.id))).json();

    await db.job.update({ where: { id: job.id }, data: { inputRequest: "做一个两件式铰链，直径间隙 0.2 到 0.3 mm，可拆" } });
    const body = await (await GET(read(), context(job.id))).json();
    expect(body.confirmed).toBe(false);
    expect(body.stale).toBe(true);
    expect(body.evidenceCurrent).toBe(false);
    expect(body.reason).toContain("request changed");
    // The stale contract is kept for comparison, but the derived one is operative.
    expect(body.previousContract).toBeDefined();
    expect(body.contractSha256).toBe(body.derivedSha256);
    expect(body.contractSha256).not.toBe(confirmed.contractSha256);
    expect(body.contract.requirements.find((item: { id: string }) => item.id === "diametral-clearance").expected).toEqual({ kind: "range", min: 0.2, max: 0.3, unit: "mm" });

    // The stale contract's hash is no longer accepted, so it cannot be re-confirmed as-is.
    expect((await PUT(write({ contract: confirmed.contract, expectedContractSha256: confirmed.contractSha256 }), context(job.id))).status).toBe(409);
    // Confirming the newly derived contract is accepted and clears staleness.
    // `confirmedContractSha256` is what the client echoes, because the operative
    // contract here is the derived one while the stored one is still the stale one.
    expect(body.confirmedContractSha256).toBe(confirmed.contractSha256);
    const reconfirmed = await PUT(write({ contract: body.contract, expectedContractSha256: body.confirmedContractSha256 }), context(job.id));
    expect(reconfirmed.status).toBe(200);
    const after = await (await GET(read(), context(job.id))).json();
    expect(after.confirmed).toBe(true);
    expect(after.stale).toBe(false);
    expect(after.evidenceCurrent).toBe(true);
  });

  test("an unreadable stored contract is reported unconfirmed instead of blocking the feature", async () => {
    const job = await db.job.create({ data: { inputRequest: HINGE } });
    await db.jobVersion.create({ data: { id: `requirement-contract:${job.id}`, jobId: job.id, field: "__requirement_contract", newValue: "{not json" } });
    const body = await (await GET(read(), context(job.id))).json();
    expect(body.confirmed).toBe(false);
    expect(body.evidenceCurrent).toBe(false);
    expect(body.reason).toContain("could not be read");
    expect(body.contract.requirements.length).toBeGreaterThan(0);
    // Recovery is possible: a fresh confirmation replaces the damaged row.
    expect((await PUT(write({ contract: body.contract, expectedContractSha256: null }), context(job.id))).status).toBe(200);
    expect((await (await GET(read(), context(job.id))).json()).confirmed).toBe(true);
  });
}
