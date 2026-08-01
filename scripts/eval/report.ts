#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import type { EvalReport, EvidenceStatus } from "./run-benchmark";

const STATUSES: EvidenceStatus[] = ["PASS", "FAIL", "SKIP", "ERROR", "NOT_RUN"];

function isStatusCounts(value: unknown): value is Record<EvidenceStatus, number> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return STATUSES.every((status) => typeof record[status] === "number");
}

export function parseEvalReport(raw: string): EvalReport {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`benchmark report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object") throw new Error("benchmark report root must be an object");
  const report = value as Partial<EvalReport>;
  if (report.schema_version !== "agentscad.eval.v1") {
    throw new Error(`unsupported benchmark schema: ${String(report.schema_version)}`);
  }
  if (!report.summary || typeof report.summary.gate_passed !== "boolean") {
    throw new Error("benchmark report is missing summary.gate_passed");
  }
  if (!isStatusCounts(report.summary.case_status_counts) || !isStatusCounts(report.summary.evidence_status_counts)) {
    throw new Error("benchmark report has invalid evidence status counts");
  }
  if (!Array.isArray(report.cases)) throw new Error("benchmark report is missing cases");
  return report as EvalReport;
}

async function main() {
  const reportPath = path.join(process.cwd(), "benchmark-results.txt");
  let raw: string;
  try {
    raw = await fs.readFile(reportPath, "utf8");
  } catch {
    throw new Error("no benchmark report found; run bun run cad:eval or bun run cad:eval:case <id> first");
  }
  const report = parseEvalReport(raw);
  console.log(JSON.stringify({
    schema_version: report.schema_version,
    run_id: report.run_id,
    created_at: report.created_at,
    mode: report.mode,
    selection: report.selection,
    provenance: report.provenance,
    summary: report.summary,
    cases: report.cases.map((result) => ({
      id: result.id,
      suite: result.suite,
      status: result.status,
      gate_passed: result.gate_passed,
      blocking_evidence: result.evidence
        .filter((item) => item.required && item.status !== "PASS")
        .map((item) => ({ name: item.name, status: item.status, reason: item.reason, error: item.error })),
    })),
  }, null, 2));
  process.exitCode = report.summary.gate_passed ? 0 : 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Report failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
