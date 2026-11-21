/**
 * Evidence diff between a recorded paid-trial report and its zero-cost rejudge.
 *
 * The rejudge runs the *current* judge over retained candidate sources. Comparing
 * the evidence ids before and after shows what the evaluator now measures that it
 * did not measure when the batch was recorded. This is a measurement of the
 * verifier, not of the model and not of candidate quality over time: the two
 * evidence sets come from different judge versions, so a status change cannot be
 * read as "the candidate improved".
 *
 * The bench layer model is applied to both sides for a normalized view, but the
 * historical trial layer table in `bench/README.md` remains built from recorded
 * paid batches only; it is never rewritten by a rejudge diff.
 */
import { readFile } from "node:fs/promises";
import { summarizeRejudgedLayers, type RejudgedCandidate } from "./rejudged-layers";
import type { EvidenceStatus } from "./layers";

export interface EvidenceRow {
  id: string;
  status: string;
}

export interface CandidateEvidence {
  taskId: string;
  attempt: number;
  evidence: EvidenceRow[];
}

export interface EvidenceChange {
  id: string;
  before: string | null;
  after: string | null;
  /** added = present only after; removed = present only before; changed = status differs. */
  kind: "added" | "removed" | "changed";
}

export interface CandidateDiff {
  taskId: string;
  attempt: number;
  added: EvidenceChange[];
  removed: EvidenceChange[];
  changed: EvidenceChange[];
  /** Layer coverage over the evidence arrays of each side, using the current layer model. */
  beforeLayers: ReturnType<typeof summarizeRejudgedLayers>;
  afterLayers: ReturnType<typeof summarizeRejudgedLayers>;
}

export interface RejudgeDiff {
  candidates: CandidateDiff[];
  totals: { added: number; removed: number; changed: number; candidates: number };
  scope: string;
}

const byId = (rows: EvidenceRow[]) => new Map(rows.map((row) => [row.id, row.status]));

/** Compare two evidence arrays for one candidate. Order of the inputs is irrelevant. */
export function diffEvidence(before: EvidenceRow[], after: EvidenceRow[]): { added: EvidenceChange[]; removed: EvidenceChange[]; changed: EvidenceChange[] } {
  const left = byId(before);
  const right = byId(after);
  const added: EvidenceChange[] = [];
  const removed: EvidenceChange[] = [];
  const changed: EvidenceChange[] = [];
  for (const [id, status] of right) {
    if (!left.has(id)) added.push({ id, before: null, after: status, kind: "added" });
    else if (left.get(id) !== status) changed.push({ id, before: left.get(id)!, after: status, kind: "changed" });
  }
  for (const [id, status] of left) {
    if (!right.has(id)) removed.push({ id, before: status, after: null, kind: "removed" });
  }
  const sort = (rows: EvidenceChange[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
  return { added: sort(added), removed: sort(removed), changed: sort(changed) };
}

/** Load the candidate/evidence pairs from the two report shapes. */
export function extractRecordedCandidates(report: unknown): CandidateEvidence[] {
  const raw = report as { allJudgements?: Array<{ taskId?: unknown; attempt?: unknown; evidence?: unknown }> };
  const candidates: CandidateEvidence[] = [];
  for (const item of raw.allJudgements ?? []) {
    if (typeof item.taskId !== "string" || !Number.isInteger(item.attempt) || !Array.isArray(item.evidence)) continue;
    candidates.push({ taskId: item.taskId, attempt: item.attempt as number, evidence: (item.evidence as EvidenceRow[]).filter((row) => row && typeof row.id === "string" && typeof row.status === "string") });
  }
  return candidates;
}

export function extractRejudgedCandidates(report: unknown): CandidateEvidence[] {
  const raw = report as { results?: Array<{ taskId?: unknown; attempt?: unknown; judgment?: { evidence?: unknown } }> };
  const candidates: CandidateEvidence[] = [];
  for (const item of raw.results ?? []) {
    if (typeof item.taskId !== "string" || !Number.isInteger(item.attempt)) continue;
    const evidence = item.judgment?.evidence;
    if (!Array.isArray(evidence)) continue;
    candidates.push({ taskId: item.taskId, attempt: item.attempt as number, evidence: (evidence as EvidenceRow[]).filter((row) => row && typeof row.id === "string" && typeof row.status === "string") });
  }
  return candidates;
}

const key = (candidate: { taskId: string; attempt: number }) => `${candidate.taskId}#${candidate.attempt}`;

/** Join the two sides by task id and attempt; a candidate missing on either side is reported, not invented. */
export function diffRejudgeReport(recorded: CandidateEvidence[], rejudged: CandidateEvidence[]): RejudgeDiff {
  const before = new Map(recorded.map((candidate) => [key(candidate), candidate]));
  const after = new Map(rejudged.map((candidate) => [key(candidate), candidate]));
  const candidates: CandidateDiff[] = [];
  for (const [id, current] of after) {
    const original = before.get(id) ?? { taskId: current.taskId, attempt: current.attempt, evidence: [] };
    const diff = diffEvidence(original.evidence, current.evidence);
    const beforeLayers = summarizeRejudgedLayers([{ taskId: original.taskId, attempt: original.attempt, evidence: original.evidence }]);
    const afterLayers = summarizeRejudgedLayers([current as RejudgedCandidate]);
    candidates.push({ taskId: current.taskId, attempt: current.attempt, ...diff, beforeLayers, afterLayers });
  }
  const totals = candidates.reduce((sum, candidate) => ({
    added: sum.added + candidate.added.length,
    removed: sum.removed + candidate.removed.length,
    changed: sum.changed + candidate.changed.length,
    candidates: sum.candidates + 1,
  }), { added: 0, removed: 0, changed: 0, candidates: 0 });
  return {
    candidates: candidates.sort((a, b) => key(a).localeCompare(key(b))),
    totals,
    scope: "Evidence diff between a recorded paid trial and a zero-cost rejudge under a different judge version. This measures verifier coverage, not candidate improvement; it is not a new trial, not a comparable series and not user acceptance.",
  };
}

const layerLine = (summary: ReturnType<typeof summarizeRejudgedLayers>) => {
  const covered = summary.layers.filter((row) => row.observed > 0).map((row) => `${row.layer}:${row.worst ?? "?"}`);
  return `${summary.coverage.passed}/${summary.coverage.observed} (${covered.join(", ") || "no layers"})`;
};

export function formatRejudgeDiff(diff: RejudgeDiff): string {
  const lines: string[] = [];
  for (const candidate of diff.candidates) {
    lines.push(`${candidate.taskId}#${candidate.attempt}`);
    lines.push(`  layers before: ${layerLine(candidate.beforeLayers)}`);
    lines.push(`  layers after:  ${layerLine(candidate.afterLayers)}`);
    for (const change of candidate.added) lines.push(`  + ${change.id} (${change.after})`);
    for (const change of candidate.removed) lines.push(`  - ${change.id} (was ${change.before})`);
    for (const change of candidate.changed) lines.push(`  ~ ${change.id}: ${change.before} -> ${change.after}`);
  }
  lines.push("");
  lines.push(`${diff.totals.candidates} candidate(s): ${diff.totals.added} evidence id(s) added, ${diff.totals.removed} removed, ${diff.totals.changed} status change(s).`);
  lines.push(diff.scope);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string) => { const index = args.indexOf(name); if (index < 0) return null; const next = args[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`); return next; };
  const beforePath = value("--before");
  const afterPath = value("--after");
  const jsonPath = value("--json");
  if (!beforePath || !afterPath) throw new Error("Usage: bun bench/rejudge-diff.ts --before <recorded report.json> --after <rejudged report.json> [--json out.json]");
  const recorded = extractRecordedCandidates(JSON.parse(await readFile(beforePath, "utf8")));
  const rejudged = extractRejudgedCandidates(JSON.parse(await readFile(afterPath, "utf8")));
  const diff = diffRejudgeReport(recorded, rejudged);
  console.log(formatRejudgeDiff(diff));
  if (jsonPath) await Bun.write(jsonPath, `${JSON.stringify(diff, null, 2)}\n`);
}
if (import.meta.main) await main();
