#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type EvidenceStatus = "PASS" | "FAIL" | "SKIP" | "ERROR" | "NOT_RUN";

export type EvidenceName =
  | "fixture_parse"
  | "part_family"
  | "parameter_schema"
  | "retrieval"
  | "intent_ambiguity"
  | "llm_generation"
  | "scad_compile"
  | "mesh_validity"
  | "bbox_match"
  | "visual_fidelity";

export interface EvidenceFact<T = unknown> {
  name: EvidenceName;
  status: EvidenceStatus;
  required: boolean;
  source: string;
  duration_ms: number;
  value?: T;
  reason?: string;
  error?: string;
}

export interface ExpectedIntent {
  status: "MATCHED" | "AMBIGUOUS" | "UNKNOWN";
  interpretations: Array<{ id: string; label: string }>;
  clarification_question?: string;
  forbidden_assumptions?: string[];
}

export interface BenchmarkCase {
  schema_version: 1;
  id: string;
  suite: "dev" | "frozen";
  difficulty: "simple" | "medium" | "hard";
  prompt: string;
  expected_part_family?: string;
  required_features: string[];
  expected_bbox?: number[];
  expected_intent?: ExpectedIntent;
  required_evidence: EvidenceName[];
  source_path: string;
  fixture_sha256: string;
}

export interface CaseResult {
  id: string;
  suite: BenchmarkCase["suite"];
  difficulty: BenchmarkCase["difficulty"];
  prompt: string;
  status: EvidenceStatus;
  gate_passed: boolean;
  expected: {
    part_family?: string;
    required_features: string[];
    expected_bbox?: number[];
    intent?: ExpectedIntent;
  };
  evidence: EvidenceFact[];
  retrieval: {
    examples: string[];
    patterns: string[];
    failures: string[];
  };
  artifacts: {
    scad: EvidenceStatus;
    stl: EvidenceStatus;
    views: EvidenceStatus;
    validation_report: EvidenceStatus;
  };
  baseline_diff: {
    status: EvidenceStatus;
    reason: string;
  };
  timings_ms: Record<string, number>;
  usage: {
    status: EvidenceStatus;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    reason: string;
  };
}

export interface EvalReport {
  schema_version: "agentscad.eval.v1";
  run_id: string;
  created_at: string;
  mode: "offline";
  selection: { fast: boolean; case_id: string | null };
  provenance: {
    commit: string;
    runtime: string;
    platform: string;
    arch: string;
    model: "NOT_RUN";
    provider: "NOT_RUN";
    openscad_backend: "NOT_RUN";
  };
  summary: {
    total_cases: number;
    gate_passed: boolean;
    case_status_counts: Record<EvidenceStatus, number>;
    evidence_status_counts: Record<EvidenceStatus, number>;
    total_duration_ms: number;
    llm_calls: number;
    estimated_cost_usd: number;
  };
  cases: CaseResult[];
}

interface LegacyBenchmarkCase {
  id?: unknown;
  prompt?: unknown;
  difficulty?: unknown;
  expected_part_type?: unknown;
  required_features?: unknown;
  expected_bbox?: unknown;
}

interface VersionedBenchmarkCase {
  schema_version?: unknown;
  id?: unknown;
  suite?: unknown;
  prompt?: unknown;
  difficulty?: unknown;
  expected_part_family?: unknown;
  required_features?: unknown;
  expected_bbox?: unknown;
  expected_intent?: unknown;
  required_evidence?: unknown;
}

const ALL_STATUSES: EvidenceStatus[] = ["PASS", "FAIL", "SKIP", "ERROR", "NOT_RUN"];
const DEFAULT_REQUIRED_EVIDENCE: EvidenceName[] = [
  "fixture_parse",
  "part_family",
  "parameter_schema",
  "retrieval",
];
const EVIDENCE_NAMES = new Set<EvidenceName>([
  ...DEFAULT_REQUIRED_EVIDENCE,
  "intent_ambiguity",
  "llm_generation",
  "scad_compile",
  "mesh_validity",
  "bbox_match",
  "visual_fidelity",
]);

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertDifficulty(value: unknown): asserts value is BenchmarkCase["difficulty"] {
  if (value !== "simple" && value !== "medium" && value !== "hard") {
    throw new Error("difficulty must be simple, medium, or hard");
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function numberArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`${field} must be an array of finite numbers`);
  }
  return value;
}

function normalizeExpectedIntent(value: unknown): ExpectedIntent | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("expected_intent must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.status !== "MATCHED" && raw.status !== "AMBIGUOUS" && raw.status !== "UNKNOWN") {
    throw new Error("expected_intent.status must be MATCHED, AMBIGUOUS, or UNKNOWN");
  }
  if (!Array.isArray(raw.interpretations)) {
    throw new Error("expected_intent.interpretations must be an array");
  }
  const interpretations = raw.interpretations.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`expected_intent.interpretations[${index}] must be an object`);
    }
    const item = candidate as Record<string, unknown>;
    assertString(item.id, `expected_intent.interpretations[${index}].id`);
    assertString(item.label, `expected_intent.interpretations[${index}].label`);
    return { id: item.id, label: item.label };
  });
  const clarificationQuestion = raw.clarification_question;
  if (clarificationQuestion !== undefined && typeof clarificationQuestion !== "string") {
    throw new Error("expected_intent.clarification_question must be a string");
  }
  return {
    status: raw.status,
    interpretations,
    clarification_question: clarificationQuestion,
    forbidden_assumptions: raw.forbidden_assumptions === undefined
      ? undefined
      : stringArray(raw.forbidden_assumptions, "expected_intent.forbidden_assumptions"),
  };
}

export function normalizeBenchmarkCase(
  rawValue: unknown,
  sourcePath: string,
  rawText = JSON.stringify(rawValue),
): BenchmarkCase {
  if (!rawValue || typeof rawValue !== "object") throw new Error("fixture root must be an object");
  const raw = rawValue as LegacyBenchmarkCase & VersionedBenchmarkCase;
  assertString(raw.id, "id");
  assertString(raw.prompt, "prompt");
  assertDifficulty(raw.difficulty);

  const versioned = raw.schema_version !== undefined;
  if (versioned && raw.schema_version !== 1) throw new Error("schema_version must be 1");

  const requiredEvidence = versioned
    ? stringArray(raw.required_evidence, "required_evidence")
    : DEFAULT_REQUIRED_EVIDENCE;
  for (const name of requiredEvidence) {
    if (!EVIDENCE_NAMES.has(name as EvidenceName)) {
      throw new Error(`required_evidence contains unknown fact: ${name}`);
    }
  }

  const suite = versioned ? raw.suite : "dev";
  if (suite !== "dev" && suite !== "frozen") throw new Error("suite must be dev or frozen");

  // Legacy expected_part_type values (for example "washer") describe semantic
  // object kinds, not the four-value PartFamily classifier. Do not compare them.
  const expectedFamily = versioned ? raw.expected_part_family : undefined;
  if (expectedFamily !== undefined && typeof expectedFamily !== "string") {
    throw new Error("expected_part_family must be a string");
  }

  return {
    schema_version: 1,
    id: raw.id,
    suite,
    difficulty: raw.difficulty,
    prompt: raw.prompt,
    expected_part_family: expectedFamily,
    required_features: stringArray(raw.required_features ?? [], "required_features"),
    expected_bbox: numberArray(raw.expected_bbox, "expected_bbox"),
    expected_intent: normalizeExpectedIntent(raw.expected_intent),
    required_evidence: requiredEvidence as EvidenceName[],
    source_path: sourcePath,
    fixture_sha256: createHash("sha256").update(rawText).digest("hex"),
  };
}

async function walkJsonFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

export async function loadBenchmarkCases(root = path.join(process.cwd(), "benchmarks")): Promise<BenchmarkCase[]> {
  const files = await walkJsonFiles(root);
  const cases = await Promise.all(files.map(async (filePath) => {
    const rawText = await fs.readFile(filePath, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`${path.relative(process.cwd(), filePath)}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return normalizeBenchmarkCase(value, path.relative(process.cwd(), filePath), rawText);
  }));
  const ids = new Set<string>();
  for (const benchmark of cases) {
    if (ids.has(benchmark.id)) throw new Error(`duplicate benchmark id: ${benchmark.id}`);
    ids.add(benchmark.id);
  }
  return cases;
}

function fact<T>(
  benchmark: BenchmarkCase,
  name: EvidenceName,
  status: EvidenceStatus,
  source: string,
  durationMs: number,
  details: { value?: T; reason?: string; error?: string } = {},
): EvidenceFact<T> {
  return {
    name,
    status,
    required: benchmark.required_evidence.includes(name),
    source,
    duration_ms: Math.round(durationMs * 100) / 100,
    ...details,
  };
}

function missingFact(benchmark: BenchmarkCase, name: EvidenceName, reason: string): EvidenceFact {
  return fact(benchmark, name, "NOT_RUN", "none", 0, { reason });
}

export function deriveCaseStatus(evidence: EvidenceFact[]): EvidenceStatus {
  const required = evidence.filter((item) => item.required);
  if (required.length === 0) return "ERROR";
  if (required.some((item) => item.status === "ERROR")) return "ERROR";
  if (required.some((item) => item.status === "FAIL")) return "FAIL";
  if (required.some((item) => item.status === "NOT_RUN")) return "NOT_RUN";
  if (required.some((item) => item.status === "SKIP")) return "SKIP";
  return required.every((item) => item.status === "PASS") ? "PASS" : "ERROR";
}

export async function runSingleBenchmark(benchmark: BenchmarkCase): Promise<CaseResult> {
  const caseStart = performance.now();
  const timings: Record<string, number> = {};
  const evidence: EvidenceFact[] = [
    fact(benchmark, "fixture_parse", "PASS", benchmark.source_path, 0, {
      value: { schema_version: benchmark.schema_version, sha256: benchmark.fixture_sha256 },
    }),
  ];
  let retrieval = { examples: [] as string[], patterns: [] as string[], failures: [] as string[] };

  try {
    const familyStart = performance.now();
    const { detectPartFamily, getParameterSchema } = await import("@/lib/harness/skill-runner");
    const actualFamily = detectPartFamily(benchmark.prompt);
    timings.part_family = performance.now() - familyStart;
    const familyMatches = benchmark.expected_part_family === undefined || actualFamily === benchmark.expected_part_family;
    evidence.push(fact(
      benchmark,
      "part_family",
      familyMatches ? "PASS" : "FAIL",
      "src/lib/harness/skill-runner.ts#detectPartFamily",
      timings.part_family,
      {
        value: { actual: actualFamily, expected: benchmark.expected_part_family ?? null },
        reason: familyMatches ? undefined : `expected ${benchmark.expected_part_family}, observed ${actualFamily}`,
      },
    ));

    const schemaStart = performance.now();
    const schema = await getParameterSchema(actualFamily, {});
    timings.parameter_schema = performance.now() - schemaStart;
    evidence.push(fact(
      benchmark,
      "parameter_schema",
      "PASS",
      "src/lib/harness/skill-runner.ts#getParameterSchema",
      timings.parameter_schema,
      { value: { family: actualFamily, parameter_count: schema.length } },
    ));

    const retrievalStart = performance.now();
    const { retrieveContext } = await import("@/lib/retrieval/example-retriever");
    const context = await retrieveContext(benchmark.prompt);
    timings.retrieval = performance.now() - retrievalStart;
    retrieval = {
      examples: context.examples.map((item) => item.name),
      patterns: context.patterns.map((item) => item.name),
      failures: context.failures.map((item) => item.name),
    };
    evidence.push(fact(
      benchmark,
      "retrieval",
      "PASS",
      "src/lib/retrieval/example-retriever.ts#retrieveContext",
      timings.retrieval,
      { value: retrieval },
    ));

    if (benchmark.expected_intent) {
      const intentStart = performance.now();
      const { analyzeCadRequest } = await import("@/lib/intake/request-intelligence");
      const observed = analyzeCadRequest(benchmark.prompt);
      timings.intent_ambiguity = performance.now() - intentStart;
      const expectedIds = benchmark.expected_intent.interpretations.map((item) => item.id);
      const observedIds = observed.interpretations.map((item) => item.id);
      const failures: string[] = [];
      if (observed.status !== benchmark.expected_intent.status) {
        failures.push(`expected status ${benchmark.expected_intent.status}, observed ${observed.status}`);
      }
      if (JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) {
        failures.push(`expected interpretations ${expectedIds.join(", ")}, observed ${observedIds.join(", ") || "none"}`);
      }
      if (
        benchmark.expected_intent.clarification_question !== undefined &&
        observed.clarificationQuestion !== benchmark.expected_intent.clarification_question
      ) {
        failures.push("clarification question does not match the frozen contract");
      }
      const assumptionText = observed.assumptions.join(" ").toLocaleLowerCase("und");
      const forbidden = (benchmark.expected_intent.forbidden_assumptions ?? [])
        .filter((assumption) => assumptionText.includes(assumption.toLocaleLowerCase("und")));
      if (forbidden.length > 0) failures.push(`unsupported assumptions observed: ${forbidden.join(", ")}`);
      evidence.push(fact(
        benchmark,
        "intent_ambiguity",
        failures.length === 0 ? "PASS" : "FAIL",
        "src/lib/intake/request-intelligence.ts#analyzeCadRequest",
        timings.intent_ambiguity,
        {
          value: observed,
          reason: failures.length > 0 ? failures.join("; ") : undefined,
        },
      ));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const name of ["part_family", "parameter_schema", "retrieval"] as EvidenceName[]) {
      if (!evidence.some((item) => item.name === name)) {
        evidence.push(fact(benchmark, name, "ERROR", "offline harness", 0, { error: message }));
      }
    }
    if (benchmark.expected_intent && !evidence.some((item) => item.name === "intent_ambiguity")) {
      evidence.push(fact(benchmark, "intent_ambiguity", "ERROR", "request intelligence", 0, { error: message }));
    }
  }

  evidence.push(
    ...(!evidence.some((item) => item.name === "intent_ambiguity")
      ? [missingFact(benchmark, "intent_ambiguity", "This fixture does not request intent evidence.")]
      : []),
    missingFact(benchmark, "llm_generation", "Offline mode makes no provider or model calls."),
    missingFact(benchmark, "scad_compile", "Offline mode did not invoke OpenSCAD."),
    missingFact(benchmark, "mesh_validity", "No STL was rendered in offline mode."),
    missingFact(benchmark, "bbox_match", "No measured mesh bounding box exists in offline mode."),
    missingFact(benchmark, "visual_fidelity", "No rendered views or visual evaluator ran in offline mode."),
  );

  timings.total = performance.now() - caseStart;
  const status = deriveCaseStatus(evidence);
  return {
    id: benchmark.id,
    suite: benchmark.suite,
    difficulty: benchmark.difficulty,
    prompt: benchmark.prompt,
    status,
    gate_passed: status === "PASS",
    expected: {
      part_family: benchmark.expected_part_family,
      required_features: benchmark.required_features,
      expected_bbox: benchmark.expected_bbox,
      intent: benchmark.expected_intent,
    },
    evidence,
    retrieval,
    artifacts: {
      scad: "NOT_RUN",
      stl: "NOT_RUN",
      views: "NOT_RUN",
      validation_report: "NOT_RUN",
    },
    baseline_diff: {
      status: "NOT_RUN",
      reason: "No stored baseline with matching evaluator schema, environment profile, and case fixture hash was supplied.",
    },
    timings_ms: Object.fromEntries(
      Object.entries(timings).map(([name, value]) => [name, Math.round(value * 100) / 100]),
    ),
    usage: {
      status: "NOT_RUN",
      llm_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      reason: "Offline mode makes no model calls; zeros describe observed usage, not model quality.",
    },
  };
}

function emptyStatusCounts(): Record<EvidenceStatus, number> {
  return { PASS: 0, FAIL: 0, SKIP: 0, ERROR: 0, NOT_RUN: 0 };
}

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export function buildReport(
  results: CaseResult[],
  options: { fast?: boolean; caseId?: string | null; totalDurationMs?: number } = {},
): EvalReport {
  const caseStatusCounts = emptyStatusCounts();
  const evidenceStatusCounts = emptyStatusCounts();
  for (const result of results) {
    caseStatusCounts[result.status]++;
    for (const item of result.evidence) evidenceStatusCounts[item.status]++;
  }
  return {
    schema_version: "agentscad.eval.v1",
    run_id: randomUUID(),
    created_at: new Date().toISOString(),
    mode: "offline",
    selection: { fast: Boolean(options.fast), case_id: options.caseId ?? null },
    provenance: {
      commit: currentCommit(),
      runtime: `bun ${Bun.version}`,
      platform: process.platform,
      arch: process.arch,
      model: "NOT_RUN",
      provider: "NOT_RUN",
      openscad_backend: "NOT_RUN",
    },
    summary: {
      total_cases: results.length,
      gate_passed: results.length > 0 && results.every((result) => result.gate_passed),
      case_status_counts: caseStatusCounts,
      evidence_status_counts: evidenceStatusCounts,
      total_duration_ms: Math.round((options.totalDurationMs ?? 0) * 100) / 100,
      llm_calls: results.reduce((total, result) => total + result.usage.llm_calls, 0),
      estimated_cost_usd: results.reduce((total, result) => total + result.usage.estimated_cost_usd, 0),
    },
    cases: results,
  };
}

function evidenceLine(item: EvidenceFact): string {
  const required = item.required ? "required" : "informational";
  const detail = item.reason ?? item.error;
  return `  ${item.status.padEnd(7)} ${item.name} (${required})${detail ? `: ${detail}` : ""}`;
}

export function formatReport(report: EvalReport): string {
  const lines = [
    "AgentSCAD Evaluation",
    `schema: ${report.schema_version}`,
    `mode: ${report.mode}`,
    `commit: ${report.provenance.commit}`,
    `cases: ${report.summary.total_cases}`,
    `gate: ${report.summary.gate_passed ? "PASS" : "FAIL"}`,
    `case statuses: ${ALL_STATUSES.map((status) => `${status}=${report.summary.case_status_counts[status]}`).join(" ")}`,
    `duration: ${report.summary.total_duration_ms.toFixed(2)}ms`,
    `model/provider/OpenSCAD: ${report.provenance.model}/${report.provenance.provider}/${report.provenance.openscad_backend}`,
    "",
  ];

  for (const result of report.cases) {
    lines.push(`${result.status} ${result.id} [${result.suite}/${result.difficulty}]`);
    if (report.selection.case_id) {
      lines.push(`prompt: ${result.prompt}`);
      if (result.expected.intent) {
        lines.push(`expected brief: ${result.expected.intent.status}`);
        for (const interpretation of result.expected.intent.interpretations) {
          lines.push(`  - ${interpretation.label} (${interpretation.id})`);
        }
        if (result.expected.intent.clarification_question) {
          lines.push(`expected question: ${result.expected.intent.clarification_question}`);
        }
        if (result.expected.intent.forbidden_assumptions?.length) {
          lines.push(`forbidden assumptions: ${result.expected.intent.forbidden_assumptions.join(", ")}`);
        }
      }
      const observedIntent = result.evidence.find((item) => item.name === "intent_ambiguity")?.value as
        | { status?: string; interpretations?: Array<{ id: string; label: string }>; clarificationQuestion?: string | null; assumptions?: string[] }
        | undefined;
      if (observedIntent?.status) {
        lines.push(`observed brief: ${observedIntent.status}`);
        for (const interpretation of observedIntent.interpretations ?? []) {
          lines.push(`  - ${interpretation.label} (${interpretation.id})`);
        }
        if (observedIntent.clarificationQuestion) {
          lines.push(`observed question: ${observedIntent.clarificationQuestion}`);
        }
        lines.push(`observed assumptions: ${observedIntent.assumptions?.join(", ") || "none"}`);
      }
      lines.push("evidence:", ...result.evidence.map(evidenceLine));
      lines.push(
        `retrieval: examples=[${result.retrieval.examples.join(", ") || "none"}] patterns=[${result.retrieval.patterns.join(", ") || "none"}] failures=[${result.retrieval.failures.join(", ") || "none"}]`,
        `artifacts: scad=${result.artifacts.scad} stl=${result.artifacts.stl} views=${result.artifacts.views} validation=${result.artifacts.validation_report}`,
        `baseline diff: ${result.baseline_diff.status} (${result.baseline_diff.reason})`,
        `timings: ${Object.entries(result.timings_ms).map(([name, duration]) => `${name}=${duration}ms`).join(" ")}`,
        `usage: ${result.usage.status}; calls=${result.usage.llm_calls}; tokens=${result.usage.input_tokens + result.usage.output_tokens}; cost=$${result.usage.estimated_cost_usd.toFixed(6)}`,
      );
    } else {
      const blocking = result.evidence.filter((item) => item.required && item.status !== "PASS");
      for (const item of blocking) lines.push(evidenceLine(item));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function parseArgs(args: string[]): { fast: boolean; caseId: string | null } {
  const fast = args.includes("--fast");
  const caseIndex = args.indexOf("--case");
  const inlineCase = args.find((arg) => arg.startsWith("--case="))?.slice("--case=".length);
  const caseId = inlineCase ?? (caseIndex >= 0 ? args[caseIndex + 1] : null);
  if (caseIndex >= 0 && !caseId) throw new Error("--case requires a case id");
  if (args.includes("--model")) {
    throw new Error("--model is not valid in offline mode: this evaluator makes no model calls. Online evaluation is not implemented yet.");
  }
  const known = new Set(["--fast", "--case"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--case=")) continue;
    if (arg === "--case") { i++; continue; }
    if (!known.has(arg)) throw new Error(`unknown argument: ${arg}`);
  }
  return { fast, caseId };
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const runStart = performance.now();
  const options = parseArgs(args);
  let cases = await loadBenchmarkCases();
  if (options.caseId) {
    cases = cases.filter((benchmark) => benchmark.id === options.caseId);
    if (cases.length === 0) {
      const available = (await loadBenchmarkCases()).map((benchmark) => benchmark.id).join(", ");
      throw new Error(`unknown case '${options.caseId}'. Available cases: ${available}`);
    }
  } else if (options.fast) {
    cases = cases.filter((benchmark) => benchmark.suite === "dev" && benchmark.difficulty === "simple");
  }

  const results: CaseResult[] = [];
  for (const benchmark of cases) results.push(await runSingleBenchmark(benchmark));
  const report = buildReport(results, {
    fast: options.fast,
    caseId: options.caseId,
    totalDurationMs: performance.now() - runStart,
  });
  const reportPath = path.join(process.cwd(), "benchmark-results.txt");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(formatReport(report));
  console.log(`\nJSON evidence report: ${reportPath}`);
  return report.summary.gate_passed ? 0 : 1;
}

if (import.meta.main) {
  runCli()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
