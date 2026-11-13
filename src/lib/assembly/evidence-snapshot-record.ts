import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { db } from "../db";
import type { AssemblyEvidenceReport } from "./assembly-evidence-report";
import type { RequirementContractRecord } from "../requirements/requirement-contract-record";

/**
 * Versioned evidence snapshot. This is an immutable *observation record*,
 * never an acceptance decision or evidence of physical functionality.
 *
 * Increment CHECKER_VERSION after changes to the meaning of measured results.
 * Existing records then become historical even if SCAD and requirements match.
 */
export const ASSEMBLY_EVIDENCE_FIELD = "__assembly_evidence_snapshot";
export const ASSEMBLY_EVIDENCE_CHECKER_VERSION = "assembly-evidence/v3";
const MAX_SNAPSHOT_BYTES = 512_000;
const MAX_HISTORY_PAGE = 20;
const SHA = /^[0-9a-f]{64}$/;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type EvidenceVersionContext = {
  sourceSha256: string | null;
  specificationSha256: string | null;
  requirementFingerprint: string;
  checkerVersion: string;
  isDelivered?: boolean;
};

export function fingerprintRequirementState(value: Pick<
  RequirementContractRecord,
  "contractSha256" | "confirmedContractSha256" | "revision" | "confirmedAt" | "evidenceCurrent" | "stale"
>): string {
  // A confirmation revision matters even when its normalized contract hash is
  // unchanged. Merely comparing the natural-language requirement is unsafe.
  return sha256(canonicalJson({
    contractSha256: value.contractSha256,
    confirmedContractSha256: value.confirmedContractSha256,
    revision: value.revision,
    confirmedAt: value.confirmedAt,
    evidenceCurrent: value.evidenceCurrent,
    stale: value.stale,
  }));
}

type SnapshotData = {
  schemaVersion: 1;
  checkerVersion: string;
  checkedAt: string;
  requirementFingerprint: string;
  report: AssemblyEvidenceReport;
};

export type StoredAssemblyEvidence = SnapshotData & { snapshotSha256: string };

/** The hash is for detecting accidental corruption, not authenticating an origin. */
export function createEvidenceSnapshot(report: AssemblyEvidenceReport, requirements: RequirementContractRecord, checkedAt = new Date().toISOString()): StoredAssemblyEvidence {
  if (report.reportSchemaVersion !== 1 ||
      !SHA.test(report.sourceSha256) ||
      !SHA.test(report.specificationSha256) ||
      !SHA.test(report.archiveSha256) ||
      !Number.isFinite(Date.parse(checkedAt))) {
    throw new Error("Cannot store a snapshot without valid source, specification and archive binding");
  }
  const base: SnapshotData = {
    schemaVersion: 1,
    checkerVersion: ASSEMBLY_EVIDENCE_CHECKER_VERSION,
    checkedAt,
    requirementFingerprint: fingerprintRequirementState(requirements),
    report,
  };
  const snapshotSha256 = sha256(canonicalJson(base));
  const snapshot = { ...base, snapshotSha256 };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) {
    throw new Error("Evidence snapshot exceeds the 512 kB limit");
  }
  return snapshot;
}

export function parseEvidenceSnapshot(value: unknown): StoredAssemblyEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<StoredAssemblyEvidence>;
  if (record.schemaVersion !== 1 ||
      typeof record.checkerVersion !== "string" || !/^assembly-evidence\/[A-Za-z0-9_-]+$/.test(record.checkerVersion) ||
      typeof record.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(record.checkedAt)) ||
      typeof record.requirementFingerprint !== "string" || !SHA.test(record.requirementFingerprint) ||
      typeof record.snapshotSha256 !== "string" || !SHA.test(record.snapshotSha256) ||
      !record.report || typeof record.report !== "object" ||
      record.report.reportSchemaVersion !== 1 ||
      typeof record.report.sourceSha256 !== "string" || !SHA.test(record.report.sourceSha256) ||
      typeof record.report.specificationSha256 !== "string" || !SHA.test(record.report.specificationSha256) ||
      typeof record.report.archiveSha256 !== "string" || !SHA.test(record.report.archiveSha256)) return null;
  const base: SnapshotData = {
    schemaVersion: 1,
    checkerVersion: record.checkerVersion,
    checkedAt: record.checkedAt,
    requirementFingerprint: record.requirementFingerprint,
    report: record.report,
  };
  if (sha256(canonicalJson(base)) !== record.snapshotSha256) return null;
  return record as StoredAssemblyEvidence;
}

export function evidenceSnapshotStanding(snapshot: StoredAssemblyEvidence, context: EvidenceVersionContext) {
  const reasons: string[] = [];
  if (context.isDelivered === false) reasons.push("Job is not currently delivered");
  if (snapshot.report.sourceSha256 !== context.sourceSha256) reasons.push("Source geometry changed");
  if (snapshot.report.specificationSha256 !== context.specificationSha256) reasons.push("Assembly specification changed");
  if (snapshot.requirementFingerprint !== context.requirementFingerprint) reasons.push("Requirement confirmation changed");
  if (snapshot.checkerVersion !== context.checkerVersion) reasons.push("Evidence checker version changed");
  return { bindingCurrent: reasons.length === 0, reasons };
}

/** Caller must already have verified the browser session / job access. */
export async function appendEvidenceSnapshot(jobId: string, snapshot: StoredAssemblyEvidence) {
  // Never overwrite a prior report; this uses a unique DB row for each run.
  return db.jobVersion.create({
    data: {
      id: "assembly-evidence:" + jobId + ":" + randomUUID(),
      jobId,
      field: ASSEMBLY_EVIDENCE_FIELD,
      newValue: JSON.stringify(snapshot),
      changedBy: "system",
    },
    select: { id: true, createdAt: true },
  });
}

/** Caller must already have verified the browser session / job access. */
export class InvalidEvidenceCursor extends Error {
  constructor() { super("Invalid evidence history cursor"); this.name = "InvalidEvidenceCursor"; }
}

export async function readEvidenceSnapshots(jobId: string, context: EvidenceVersionContext, limit = 10, beforeId?: string) {
  const take = Math.min(Math.max(Number.isInteger(limit) ? limit : 10, 1), MAX_HISTORY_PAGE);
  if (beforeId) {
    const cursor = await db.jobVersion.findFirst({
      where: { id: beforeId, jobId, field: ASSEMBLY_EVIDENCE_FIELD }, select: { id: true },
    });
    if (!cursor) throw new InvalidEvidenceCursor();
  }
  const rows = await db.jobVersion.findMany({
    where: { jobId, field: ASSEMBLY_EVIDENCE_FIELD },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(beforeId ? { cursor: { id: beforeId }, skip: 1 } : {}),
    take: take + 1,
  });
  const page = rows.slice(0, take);
  const snapshots = page.map(row => {
    let parsed: StoredAssemblyEvidence | null = null;
    try { parsed = parseEvidenceSnapshot(JSON.parse(row.newValue ?? "")); } catch { /* Corrupt records cannot produce PASS. */ }
    if (!parsed) return {
      id: row.id,
      savedAt: row.createdAt.toISOString(),
      integrity: "ERROR" as const,
      bindingCurrent: false,
      reasons: ["Stored evidence could not be read or its digest did not match"],
      snapshot: null,
    };
    const standing = evidenceSnapshotStanding(parsed, context);
    return {
      id: row.id,
      savedAt: row.createdAt.toISOString(),
      integrity: "PASS" as const,
      ...standing,
      snapshot: parsed,
    };
  });
  return { snapshots, nextCursor: rows.length > take ? page[page.length - 1].id : null };
}
