/**
 * Turns a trial report into scored tasks.
 *
 * Input is the JSON the paid trial already writes, so this measures history
 * rather than asking for a new file format. Two axes are produced:
 *
 *   A: coverage, the share of observed layers that passed.
 *   B: coverage bought per model call and per unit of spend.
 *
 * The A axis rewards a better base model. The B axis is the only one that can
 * reward a better harness, because the harness is what decides how much a call
 * is worth.
 */
import { aggregateLayers, scoreEvidence, type LayerAggregate, type LayerResult, type ScoredLayers } from "./layers";

export interface TrialReportInput {
  model?: unknown;
  mode?: unknown;
  startedAt?: unknown;
  durationMs?: unknown;
  taskSetSha256?: unknown;
  tasks?: unknown;
  /** Present on reports written by the paid trial; absent on older ones. */
  coverageExclusions?: unknown;
}

export interface ScoredTask {
  id: string;
  status: string;
  gate: boolean | null;
  gateReason: string;
  layers: ScoredLayers["layers"];
  coverage: ScoredLayers["coverage"];
  unmappedEvidence: string[];
  attempts: number;
  calls: number;
  usd: number;
  /** Coverage divided by model calls; `null` when no call was made. */
  coveragePerCall: number | null;
  /** Coverage divided by recorded spend; `null` when spend is zero or unknown. */
  coveragePerUsd: number | null;
  /** The gate value the report stored, so a producer/consumer drift is visible. */
  storedGate: boolean | null;
  storedGateAgrees: boolean | null;
  reason: string;
}

export interface ScoredRun {
  runId: string;
  reportPath: string;
  model: string | null;
  mode: string | null;
  startedAt: string | null;
  taskSetSha256: string | null;
  tasks: ScoredTask[];
  summary: {
    tasks: number;
    tasksWithEvidence: number;
    gatePassed: number;
    meanCoverage: number | null;
    bestCoverage: number | null;
    bestTask: string | null;
    calls: number;
    usd: number;
  };
  coverageExclusions: string[];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function evidenceOf(value: unknown): Array<{ id: string; status: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.status !== "string") return [];
    return [{ id: entry.id, status: entry.status }];
  });
}

export function scoreRun(runId: string, reportPath: string, report: TrialReportInput): ScoredRun {
  const rawTasks = Array.isArray(report.tasks) ? report.tasks : [];
  const tasks: ScoredTask[] = rawTasks.map((raw, index) => {
    const task = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const evidence = evidenceOf(task.evidence);
    const scored = scoreEvidence(evidence);
    const calls = asNumber(task.calls);
    const usd = asNumber(task.usd);
    const ratio = scored.coverage.ratio;
    const storedGate = typeof task.measuredCorePassed === "boolean" ? task.measuredCorePassed : null;
    const gate = scored.gate.passed;
    return {
      id: asString(task.id) ?? `task-${index}`,
      status: asString(task.status) ?? "UNKNOWN",
      gate,
      gateReason: scored.gate.reason,
      layers: scored.layers,
      coverage: scored.coverage,
      unmappedEvidence: scored.unmappedEvidence,
      attempts: asNumber(task.attempts),
      calls,
      usd,
      coveragePerCall: ratio !== null && calls > 0 ? ratio / calls : null,
      coveragePerUsd: ratio !== null && usd > 0 ? ratio / usd : null,
      storedGate,
      storedGateAgrees: storedGate === null || gate === null ? null : storedGate === gate,
      reason: asString(task.reason) ?? "",
    };
  });

  const withEvidence = tasks.filter((task) => task.coverage.observed > 0);
  const ratios = withEvidence.flatMap((task) => (task.coverage.ratio === null ? [] : [task.coverage.ratio]));
  const ranked = withEvidence.filter((task) => task.coverage.ratio !== null);
  const best = ranked.length === 0
    ? null
    : ranked.reduce((winner, task) => ((task.coverage.ratio ?? 0) > (winner.coverage.ratio ?? 0) ? task : winner));

  return {
    runId,
    reportPath,
    model: asString(report.model),
    mode: asString(report.mode),
    startedAt: asString(report.startedAt),
    taskSetSha256: asString(report.taskSetSha256),
    tasks,
    summary: {
      tasks: tasks.length,
      tasksWithEvidence: withEvidence.length,
      gatePassed: tasks.filter((task) => task.gate === true).length,
      meanCoverage: ratios.length === 0 ? null : ratios.reduce((sum, value) => sum + value, 0) / ratios.length,
      bestCoverage: best?.coverage.ratio ?? null,
      bestTask: best?.id ?? null,
      calls: tasks.reduce((sum, task) => sum + task.calls, 0),
      usd: tasks.reduce((sum, task) => sum + task.usd, 0),
    },
    coverageExclusions: Array.isArray(report.coverageExclusions)
      ? report.coverageExclusions.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export interface LadderReport {
  schemaVersion: "assembly-ladder.v1";
  createdAt: string;
  runs: ScoredRun[];
  aggregate: {
    candidates: number;
    candidatesWithEvidence: number;
    gatePassed: number;
    meanCoverage: number | null;
    layers: LayerAggregate[];
    unmappedEvidence: Array<{ id: string; count: number }>;
  };
  warnings: string[];
}

export function buildLadderReport(runs: ScoredRun[]): LadderReport {
  const allTasks = runs.flatMap((run) => run.tasks);
  const withEvidence = allTasks.filter((task) => task.coverage.observed > 0);
  const ratios = withEvidence.flatMap((task) => (task.coverage.ratio === null ? [] : [task.coverage.ratio]));
  const warnings: string[] = [];

  // Cross-run aggregation is over the *same* evidence taxonomy but not
  // necessarily the same task set or verifier version. Say so in the artefact
  // rather than leaving a reader to assume the series is comparable.
  const taskSets = new Set(runs.map((run) => run.taskSetSha256).filter((value): value is string => value !== null));
  if (taskSets.size > 1) {
    warnings.push(`Aggregated across ${taskSets.size} task-set versions: read the shape, not the levels.`);
  }
  if (runs.some((run) => run.tasks.some((task) => task.storedGateAgrees === false))) {
    warnings.push("A stored measuredCorePassed disagrees with the gate recomputed from evidence; check the producer.");
  }
  const unmapped = new Map<string, number>();
  for (const task of allTasks) for (const id of task.unmappedEvidence) unmapped.set(id, (unmapped.get(id) ?? 0) + 1);
  if (unmapped.size > 0) {
    const listed = [...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => `${id}×${count}`).join(", ");
    // These are not lost: they still feed the gate, they just do not earn
    // coverage. Naming them stops a reader assuming the layer table is complete.
    warnings.push(`Evidence outside every layer (affects the gate only, earns no coverage): ${listed}.`);
  }

  return {
    schemaVersion: "assembly-ladder.v1",
    createdAt: new Date().toISOString(),
    runs,
    aggregate: {
      candidates: allTasks.length,
      candidatesWithEvidence: withEvidence.length,
      gatePassed: allTasks.filter((task) => task.gate === true).length,
      meanCoverage: ratios.length === 0 ? null : ratios.reduce((sum, value) => sum + value, 0) / ratios.length,
      layers: aggregateLayers(withEvidence.map((task) => ({
        layers: task.layers as LayerResult[],
        coverage: task.coverage,
        gate: { passed: task.gate, reason: task.gateReason },
        unmappedEvidence: task.unmappedEvidence,
      }))),
      unmappedEvidence: [...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count })),
    },
    warnings,
  };
}
