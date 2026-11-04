import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJobAccessScope, jobAccessFilter } from "@/lib/job-session";
import { canProcessJobState } from "@/lib/pipeline/job-execution";
import {
  readRequirementContract,
  readRequirementRevisions,
  RequirementContractError,
  saveRequirementContract,
} from "@/lib/requirements/requirement-contract-record";

type Context = { params: Promise<{ id: string }> };
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * GET /api/jobs/[id]/requirements
 *
 * Returns the contract evidence must be judged against. When nothing has been
 * confirmed the derived contract is returned with `confirmed: false` and
 * `evidenceCurrent: false`; when the request has changed since confirmation the
 * record is reported `stale` and the freshly derived contract becomes operative.
 * `?history=1` additionally lists confirmed revisions, newest first.
 */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) }, select: { inputRequest: true } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!job.inputRequest.trim()) return NextResponse.json({ error: "Job has no request text to derive from" }, { status: 409 });
    const record = await readRequirementContract(id, job.inputRequest);
    const body: Record<string, unknown> = {
      ...record,
      derivedFrom: record.confirmed ? "storedContract" : "inputRequest",
    };
    if (new URL(request.url).searchParams.get("history") === "1") {
      body.revisions = await readRequirementRevisions(id, job.inputRequest);
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error reading requirement contract", error);
    return NextResponse.json({ error: "Failed to read requirement contract" }, { status: 500 });
  }
}

/**
 * PUT /api/jobs/[id]/requirements
 *
 * Confirms or edits the contract. `expectedContractSha256` is the hash the
 * client last saw (`null` when it saw none), so a concurrent confirmation
 * conflicts instead of being overwritten.
 */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const access = await getJobAccessScope(request);
    if (!access) return NextResponse.json({ error: "Browser session required" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => null) as { contract?: unknown; expectedContractSha256?: unknown } | null;
    if (typeof body !== "object" || body === null) return NextResponse.json({ error: "A JSON body with a contract is required" }, { status: 400 });
    const expected = body.expectedContractSha256;
    if (!(expected === null || (typeof expected === "string" && SHA256.test(expected)))) {
      return NextResponse.json({ error: "expectedContractSha256 must be null or a SHA-256 hex string" }, { status: 400 });
    }
    const job = await db.job.findFirst({
      where: { id, ...jobAccessFilter(access) },
      select: { id: true, inputRequest: true, state: true, updatedAt: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!job.inputRequest.trim()) return NextResponse.json({ error: "Job has no request text to confirm against" }, { status: 409 });
    if (!canProcessJobState(job.state)) return NextResponse.json({ error: "Job is processing; refresh before confirming" }, { status: 409 });

    const saved = await saveRequirementContract({ job, contract: body.contract, expectedContractSha256: expected });
    return NextResponse.json({
      contract: saved.contract,
      contractSha256: saved.contractSha256,
      confirmedContractSha256: saved.contractSha256,
      confirmed: true,
      stale: false,
      edited: saved.edited,
      revision: saved.revision,
      confirmedAt: saved.confirmedAt,
      evidenceCurrent: true,
      reason: null,
      derivedFrom: "storedContract",
    });
  } catch (error) {
    if (error instanceof RequirementContractError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && String(error.code) === "P2034") {
      return NextResponse.json({ error: "The confirmed contract changed; refresh before confirming." }, { status: 409 });
    }
    console.error("Error saving requirement contract", error);
    return NextResponse.json({ error: "Failed to save requirement contract" }, { status: 500 });
  }
}
