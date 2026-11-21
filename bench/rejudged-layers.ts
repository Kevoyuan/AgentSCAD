/**
 * Layer summary for zero-cost rejudged candidates.
 *
 * `scripts/eval/rejudge-assembly-trial.ts` re-runs the product's judge over
 * retained model artifacts without any model call. Those judgements are new
 * measurements of old candidate sources, not a new trial. This module feeds
 * their evidence through the same layer model as `bench/layers.ts` so a reader
 * can see which layers the current judge actually observes, without treating
 * the rejudged set as a comparable trial series.
 *
 * It deliberately depends only on plain evidence arrays: the rejudge tool may
 * import it, but it never imports the product evaluator or the product pipeline,
 * so the benchmark does not inherit the judged system's shape.
 */
import {
  LAYERS,
  scoreEvidence,
  worstStatus,
  type EvidenceStatus,
  type LayerId,
} from "./layers";

export interface RejudgedCandidate {
  taskId: string;
  attempt: number;
  /** Evidence emitted by the current judge, in its own order. */
  evidence: Array<{ id: string; status: string }>;
}

export interface RejudgedLayerRow {
  layer: LayerId;
  subsystem: string;
  /** Candidates whose evidence touched this layer. */
  observed: number;
  passed: number;
  failed: number;
  notRun: number;
  error: number;
  skip: number;
  /** Worst status across observed candidates; null when the layer was never observed. */
  worst: EvidenceStatus | null;
}

export interface RejudgedLayerSummary {
  candidates: number;
  evidenceEntries: number;
  /** Candidates whose delivery gate passed under the current judge. Null when none observed evidence. */
  gatePassed: number | null;
  /** Passed layers / observed layers, summed across candidates. */
  coverage: { passed: number; observed: number; ratio: number | null };
  layers: RejudgedLayerRow[];
  /** Evidence ids the layer model does not map. Reported, never dropped. */
  unmappedEvidence: string[];
  /** Explicit scope sentence for reports. */
  scope: string;
}

const STATUS_FIELDS: Record<Exclude<EvidenceStatus, never>, "passed" | "failed" | "notRun" | "error" | "skip"> = {
  PASS: "passed",
  FAIL: "failed",
  NOT_RUN: "notRun",
  ERROR: "error",
  SKIP: "skip",
};

/**
 * Aggregate layer coverage over rejudged candidates.
 *
 * A layer's `worst` status is the repository precedence (ERROR > FAIL > NOT_RUN
 * > SKIP > PASS), so one non-passing candidate is not hidden by passing ones.
 * Unobserved layers stay visible instead of entering the denominator.
 */
export function summarizeRejudgedLayers(candidates: RejudgedCandidate[]): RejudgedLayerSummary {
  const rows = LAYERS.map<RejudgedLayerRow>((spec) => ({
    layer: spec.id, subsystem: spec.subsystem, observed: 0, passed: 0, failed: 0, notRun: 0, error: 0, skip: 0, worst: null,
  }));
  const byLayer = new Map(rows.map((row) => [row.layer, row]));
  const unmapped = new Set<string>();
  let evidenceEntries = 0;
  let gatePassed: number | null = null;
  let passedLayers = 0;
  let observedLayers = 0;

  for (const candidate of candidates) {
    evidenceEntries += candidate.evidence.length;
    const scored = scoreEvidence(candidate.evidence);
    for (const unmappedId of scored.unmappedEvidence) unmapped.add(unmappedId);
    if (scored.gate.passed !== null) gatePassed = (gatePassed ?? 0) + (scored.gate.passed ? 1 : 0);
    for (const result of scored.layers) {
      if (result.status === null) continue;
      const row = byLayer.get(result.layer);
      if (!row) continue;
      row.observed += 1;
      for (const item of result.evidence) {
        const field = STATUS_FIELDS[item.status];
        row[field] += 1;
      }
      row.worst = row.worst === null ? result.status : worstStatus([row.worst, result.status]);
    }
    passedLayers += scored.coverage.passed;
    observedLayers += scored.coverage.observed;
  }

  return {
    candidates: candidates.length,
    evidenceEntries,
    gatePassed,
    coverage: { passed: passedLayers, observed: observedLayers, ratio: observedLayers === 0 ? null : passedLayers / observedLayers },
    layers: rows,
    unmappedEvidence: [...unmapped].sort(),
    scope: "Zero-model-cost rejudge of retained candidate sources under the current judge. This is not a new model trial, not a comparable series with the recorded trial history, and not user acceptance or physical function.",
  };
}

/** One compact table, in the same shape as the bench README layer table. */
export function formatRejudgedLayers(summary: RejudgedLayerSummary): string {
  const pad = (value: string, width: number) => value.padEnd(width).slice(0, width);
  const header = [pad("layer", 17), pad("obs", 5), pad("pass", 5), pad("fail", 5), pad("error", 6), pad("not_run", 8), pad("worst", 9), "repair target"].join(" ");
  const lines = [header, "-".repeat(header.length)];
  for (const row of summary.layers) {
    lines.push([pad(row.layer, 17), pad(String(row.observed), 5), pad(String(row.passed), 5), pad(String(row.failed), 5), pad(String(row.error), 6), pad(String(row.notRun), 8), pad(row.worst ?? "absent", 9), row.subsystem].join(" "));
  }
  const ratio = summary.coverage.ratio === null ? "—" : `${(summary.coverage.ratio * 100).toFixed(1)}%`;
  lines.push("");
  lines.push(`${summary.candidates} candidate(s), ${summary.evidenceEntries} evidence entries; coverage ${summary.coverage.passed}/${summary.coverage.observed} (${ratio}); gate passed ${summary.gatePassed ?? "not observed"}.`);
  if (summary.unmappedEvidence.length) lines.push(`Unmapped evidence (reported, not scored): ${summary.unmappedEvidence.join(", ")}`);
  return lines.join("\n");
}
