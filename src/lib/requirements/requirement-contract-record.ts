/**
 * Persistence for the requirement contract.
 *
 * Shape mirrors the assembly declaration store: one row is the *current
 * pointer*, and every save also appends an immutable revision row. A later save
 * can therefore never rewrite what the user previously confirmed, and the
 * history stays bounded instead of growing without limit.
 *
 * The rules that make confirmation honest live in `requirement-contract.ts`
 * (`normalizeConfirmedContract`); this module adds the storage-level guarantees:
 * a contract may only be stored against the request it was derived from, and
 * the request hash is checked server-side so a client cannot confirm a contract
 * for text the user never wrote.
 */
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { sha256Hex } from "../canonical-json";
import { deriveRequirementContract } from "./extract-requirements";
import {
  isContractStale,
  normalizeConfirmedContract,
  requirementContractHash,
  RequirementContractError,
  validateRequirementContract,
  type RequirementContract,
} from "./requirement-contract";

export { normalizeConfirmedContract, RequirementContractError } from "./requirement-contract";

export const REQUIREMENT_CONTRACT_FIELD = "__requirement_contract";
export const REQUIREMENT_REVISION_FIELD = "__requirement_contract_revision";
export const REQUIREMENT_REVISION_LIMIT = 20;
const REVISION_PAYLOAD_BUDGET = 1_000_000;

export const requirementRecordId = (jobId: string) => `requirement-contract:${jobId}`;
export const requirementRevisionId = (jobId: string) => `requirement-contract-rev:${jobId}:${randomUUID()}`;

export interface RequirementContractRecord {
  /** The contract evidence must be judged against. */
  contract: RequirementContract;
  contractSha256: string;
  /**
   * Hash of the stored confirmation, or null when nothing is confirmed. This is
   * the value a client must echo as `expectedContractSha256`; it differs from
   * `contractSha256` exactly when the operative contract is a fresh derivation
   * rather than a confirmed one.
   */
  confirmedContractSha256: string | null;
  /** True only for a stored contract whose request still matches. */
  confirmed: boolean;
  /** A previously confirmed contract no longer matches the current request. */
  stale: boolean;
  /** The confirmed contract differs from what a fresh derivation would produce. */
  edited: boolean;
  revision: number | null;
  confirmedAt: string | null;
  /** Always available, so a user can see what the current request would produce. */
  derived: RequirementContract;
  derivedSha256: string;
  /** Present only when stale, so the caller can show what changed. */
  previousContract?: RequirementContract;
  /** True only when a human confirmed this exact contract against this exact request. */
  evidenceCurrent: boolean;
  /** Why evidence cannot count as current, or null when it can. */
  reason: string | null;
}

function parseStored(value: string | null): { contract: RequirementContract; revision: number; confirmedAt: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(value ?? ""); } catch { return null; }
  const record = parsed as { contract?: unknown; revision?: unknown; confirmedAt?: unknown } | null;
  const contract = validateRequirementContract(record?.contract);
  if (!contract.success) return null;
  if (typeof record?.revision !== "number" || !Number.isInteger(record.revision) || record.revision < 1) return null;
  if (typeof record?.confirmedAt !== "string" || Number.isNaN(Date.parse(record.confirmedAt))) return null;
  return { contract: contract.data, revision: record.revision, confirmedAt: record.confirmedAt };
}

/**
 * Caller must perform session authorization before reading this job's record.
 *
 * A stored row that cannot be read is reported as unconfirmed rather than
 * throwing: the derived contract is always available, and a corrupt row must
 * not make the feature unreachable. `reason` says so explicitly, so nothing is
 * silently treated as approved.
 */
export async function readRequirementContract(jobId: string, inputRequest: string): Promise<RequirementContractRecord> {
  const derived = deriveRequirementContract({ request: inputRequest });
  const derivedSha256 = requirementContractHash(derived);
  const base = { derived, derivedSha256 };
  const row = await db.jobVersion.findUnique({ where: { id: requirementRecordId(jobId) } });
  if (!row) {
    return {
      ...base, contract: derived, contractSha256: derivedSha256, confirmedContractSha256: null, confirmed: false, stale: false, edited: false,
      revision: null, confirmedAt: null, evidenceCurrent: false,
      reason: "The contract has not been confirmed, so no evidence can count as current yet.",
    };
  }
  const stored = parseStored(row.newValue);
  if (!stored) {
    return {
      ...base, contract: derived, contractSha256: derivedSha256, confirmedContractSha256: null, confirmed: false, stale: false, edited: false,
      revision: null, confirmedAt: null, evidenceCurrent: false,
      reason: "The stored contract could not be read, so nothing counts as confirmed. Confirm the derived contract again to replace it.",
    };
  }
  const storedSha256 = requirementContractHash(stored.contract);
  if (isContractStale(stored.contract, inputRequest)) {
    return {
      ...base, contract: derived, contractSha256: derivedSha256, confirmedContractSha256: storedSha256, confirmed: false, stale: true, edited: false,
      revision: stored.revision, confirmedAt: stored.confirmedAt, previousContract: stored.contract, evidenceCurrent: false,
      reason: "The request changed after this contract was confirmed. Evidence produced under the old contract is not current; confirm the derived contract.",
    };
  }
  return {
    ...base, contract: stored.contract, contractSha256: storedSha256, confirmedContractSha256: storedSha256, confirmed: true, stale: false,
    edited: storedSha256 !== derivedSha256, revision: stored.revision, confirmedAt: stored.confirmedAt,
    evidenceCurrent: true, reason: null,
  };
}

export interface RequirementRevision {
  id: string;
  revision: number | null;
  savedAt: string;
  requestSha256: string;
  contractSha256: string;
  stale: boolean;
  contract: RequirementContract;
}

/**
 * Confirmed contracts, newest first. Malformed rows are skipped rather than
 * reported as valid history.
 */
export async function readRequirementRevisions(jobId: string, currentRequest: string, limit = REQUIREMENT_REVISION_LIMIT): Promise<RequirementRevision[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || REQUIREMENT_REVISION_LIMIT, 1), REQUIREMENT_REVISION_LIMIT);
  const rows = await db.jobVersion.findMany({
    where: { jobId, field: REQUIREMENT_REVISION_FIELD },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  const requestSha256 = sha256Hex(currentRequest.trim());
  const revisions: RequirementRevision[] = [];
  let budget = REVISION_PAYLOAD_BUDGET;
  for (const row of rows) {
    let value: { revision?: unknown; contract?: unknown };
    try { value = JSON.parse(row.newValue ?? ""); } catch { continue; }
    const parsed = validateRequirementContract(value?.contract);
    if (!parsed.success) continue;
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > budget) break;
    budget -= serialized.length;
    revisions.push({
      id: row.id,
      revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0 ? value.revision : null,
      savedAt: row.createdAt.toISOString(),
      requestSha256: parsed.data.requestSha256,
      contractSha256: requirementContractHash(parsed.data),
      stale: parsed.data.requestSha256 !== requestSha256,
      contract: parsed.data,
    });
  }
  return revisions;
}

export interface SaveRequirementContractInput {
  job: { id: string; inputRequest: string; state: string; updatedAt: Date };
  contract: unknown;
  /** `null` means "I believe nothing has been confirmed yet". */
  expectedContractSha256: string | null;
}

/**
 * Confirms or edits the contract. Throws `RequirementContractError` for every
 * refusal the caller should surface, so the route does not re-implement policy.
 */
export async function saveRequirementContract(input: SaveRequirementContractInput) {
  const parsed = validateRequirementContract(input.contract);
  if (!parsed.success) throw new RequirementContractError(`Invalid requirement contract: ${parsed.error.issues[0]?.message ?? "unknown problem"}`, 400);
  const submitted = parsed.data;

  const currentRequestSha256 = sha256Hex(input.job.inputRequest.trim());
  if (submitted.requestSha256 !== currentRequestSha256) {
    throw new RequirementContractError("The contract was derived from different request text. Re-derive it before confirming.");
  }

  const derived = deriveRequirementContract({ request: input.job.inputRequest });
  const normalized = normalizeConfirmedContract(submitted, derived);
  const contractSha256 = requirementContractHash(normalized);
  const serialized = JSON.stringify({ contract: normalized, contractSha256 });
  if (Buffer.byteLength(serialized) > 1_000_000) throw new RequirementContractError("Requirement contract too large", 400);

  return db.$transaction(async (tx) => {
    // Claiming the job row serialises concurrent confirmations and refuses to
    // run while a generation lease is held, so evidence cannot be produced
    // against one contract while another is being installed.
    const claimed = await tx.job.updateMany({
      where: { id: input.job.id, state: input.job.state, updatedAt: input.job.updatedAt, versions: { none: { field: "__execution_lock" } } },
      data: { updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new RequirementContractError("Job changed or is processing; refresh before confirming.");

    const previous = await tx.jobVersion.findUnique({ where: { id: requirementRecordId(input.job.id) } });
    // An unreadable row is treated as absent so the store stays recoverable; the
    // revision payload records that it replaced one, so the history stays honest.
    const previousRecord = previous ? parseStored(previous.newValue) : null;
    const previousSha256 = previousRecord ? requirementContractHash(previousRecord.contract) : null;
    if (previousSha256 !== input.expectedContractSha256) {
      throw new RequirementContractError("The confirmed contract changed; refresh before confirming.");
    }

    const latest = await tx.jobVersion.findFirst({
      where: { jobId: input.job.id, field: REQUIREMENT_REVISION_FIELD },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { newValue: true },
    });
    let revision = 1;
    if (latest) {
      try {
        const value = JSON.parse(latest.newValue ?? "") as { revision?: unknown };
        if (typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0) revision = value.revision + 1;
      } catch { /* An unreadable row must not block a save; numbering restarts at 1. */ }
    }

    const confirmedAt = new Date().toISOString();
    // The contract's own revision is stamped so a stored contract is
    // self-describing; it is excluded from the contract hash.
    const stored = { ...normalized, revision };
    const pointerValue = JSON.stringify({ contract: stored, contractSha256, revision, confirmedAt });
    await tx.jobVersion.upsert({
      where: { id: requirementRecordId(input.job.id) },
      create: { id: requirementRecordId(input.job.id), jobId: input.job.id, field: REQUIREMENT_CONTRACT_FIELD, newValue: pointerValue, changedBy: "user" },
      update: { newValue: pointerValue, changedBy: "user", createdAt: new Date() },
    });
    await tx.jobVersion.create({
      data: {
        id: requirementRevisionId(input.job.id), jobId: input.job.id, field: REQUIREMENT_REVISION_FIELD, changedBy: "user",
        newValue: JSON.stringify({ revision, contract: stored, contractSha256, previousContractSha256: previousSha256, confirmedAt, replacedUnreadable: previous !== null && previousRecord === null }),
      },
    });
    const expired = await tx.jobVersion.findMany({
      where: { jobId: input.job.id, field: REQUIREMENT_REVISION_FIELD },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: REQUIREMENT_REVISION_LIMIT,
      select: { id: true },
    });
    if (expired.length > 0) await tx.jobVersion.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });

    return { contract: stored, contractSha256, revision, confirmedAt, edited: contractSha256 !== requirementContractHash(derived) };
  });
}
