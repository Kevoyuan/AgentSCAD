import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson } from "../canonical-json";
import type { RequirementContractRecord } from "../requirements/requirement-contract-record";
import type { AssemblyEvidenceReport } from "./assembly-evidence-report";
import {
  ASSEMBLY_EVIDENCE_CHECKER_VERSION,
  createEvidenceSnapshot, evidenceSnapshotStanding,
  fingerprintRequirementState, parseEvidenceSnapshot,
} from "./evidence-snapshot-record";

const sha = (character: string) => character.repeat(64);
const req = (overrides: Partial<RequirementContractRecord> = {}) => ({
  contractSha256: sha("a"),
  confirmedContractSha256: sha("a"),
  revision: 1,
  confirmedAt: "2026-11-13T12:00:00.000Z",
  evidenceCurrent: true,
  stale: false,
  ...overrides,
}) as RequirementContractRecord;
const report = () => ({
  reportSchemaVersion: 1,
  archiveSha256: sha("e"),
  sourceSha256: sha("b"),
  specificationSha256: sha("c"),
  contract: { evidenceCurrent: true, reason: "current", binding: { sha256: sha("a"), revision: 1 } },
  evidence: { disassembly: { status: "NOT_RUN", reason: "not confirmed" }, physical: { status: "NOT_RUN", reason: "not tested" } },
  disassembly: { measuredStatus: "PASS", status: "NOT_RUN", method: "sampled", operations: [] },
}) as unknown as AssemblyEvidenceReport;
const context = (requirements = req()) => ({
  sourceSha256: sha("b"),
  specificationSha256: sha("c"),
  requirementFingerprint: fingerprintRequirementState(requirements),
  checkerVersion: ASSEMBLY_EVIDENCE_CHECKER_VERSION,
  isDelivered: true,
});

test("snapshots bind the exact measured report, datetime, requirements and tool version", () => {
  const requirements = req();
  const created = createEvidenceSnapshot(report(), requirements, "2026-11-13T12:01:00.000Z");
  const read = parseEvidenceSnapshot(JSON.parse(JSON.stringify(created)));
  expect(read).not.toBeNull();
  expect(read?.snapshotSha256).toBe(created.snapshotSha256);
  expect(evidenceSnapshotStanding(created, context()).bindingCurrent).toBe(true);
  const tampered = structuredClone(created);
  tampered.report.evidence.disassembly.status = "PASS";
  expect(parseEvidenceSnapshot(tampered)).toBeNull();
  const tamperedDate = { ...created, checkedAt: "2026-11-13T12:02:00.000Z" };
  expect(parseEvidenceSnapshot(tamperedDate)).toBeNull();
});

test("source, specification, confirmation revision and non-delivered state invalidate old standing", () => {
  const stored = createEvidenceSnapshot(report(), req());
  expect(evidenceSnapshotStanding(stored, { ...context(), sourceSha256: sha("f") }).reasons).toContain("Source geometry changed");
  expect(evidenceSnapshotStanding(stored, { ...context(), specificationSha256: sha("f") }).reasons).toContain("Assembly specification changed");
  expect(evidenceSnapshotStanding(stored, context(req({ revision: 2 }))).reasons).toContain("Requirement confirmation changed");
  expect(evidenceSnapshotStanding(stored, context(req({ confirmedAt: "2026-11-13T12:04:00.000Z" }))).bindingCurrent).toBe(false);
  expect(evidenceSnapshotStanding(stored, { ...context(), isDelivered: false }).reasons).toContain("Job is not currently delivered");
  expect(evidenceSnapshotStanding(stored, { ...context(), checkerVersion: "assembly-evidence/v4" }).reasons).toContain("Evidence checker version changed");
});

test("old checker versions remain inspectable but cannot count as current", () => {
  const stored = createEvidenceSnapshot(report(), req());
  const { snapshotSha256: _oldHash, ...payload } = stored;
  const oldPayload = { ...payload, checkerVersion: "assembly-evidence/v1" };
  const old = {
    ...oldPayload,
    snapshotSha256: createHash("sha256").update(canonicalJson(oldPayload)).digest("hex"),
  };
  const recovered = parseEvidenceSnapshot(old);
  expect(recovered).not.toBeNull();
  expect(evidenceSnapshotStanding(recovered!, context()).reasons).toContain("Evidence checker version changed");
});

test("bad or incomplete records cannot appear as valid evidence", () => {
  expect(parseEvidenceSnapshot(null)).toBeNull();
  expect(parseEvidenceSnapshot({ report: report(), snapshotSha256: sha("0") })).toBeNull();
  expect(() => createEvidenceSnapshot({ ...report(), sourceSha256: "" }, req())).toThrow("binding");
  expect(fingerprintRequirementState(req())).not.toBe(fingerprintRequirementState(req({ confirmedAt: "2026-11-13T12:05:00.000Z" })));
});
