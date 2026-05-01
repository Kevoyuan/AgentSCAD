// ---------------------------------------------------------------------------
// Benchmark report aggregator — parses benchmark-results.txt and outputs
// a structured JSON summary for CI and dashboard integration.
// ---------------------------------------------------------------------------

import fs from "fs/promises";
import path from "path";

interface MetricSummary {
  json_parse_pct: number;
  compile_success_pct: number;
  mesh_valid_pct: number;
  bbox_match_pct: number;
  avg_feature_score: number;
  avg_latency_s: number;
  avg_llm_calls: number;
  total_cases: number;
  passed_cases: number;
  pass_rate_pct: number;
}

async function main() {
  const reportPath = path.join(process.cwd(), "benchmark-results.txt");
  let content: string;
  try {
    content = await fs.readFile(reportPath, "utf8");
  } catch {
    console.log(JSON.stringify({ error: "No benchmark results found. Run cad:eval first." }));
    process.exit(0);
  }

  // Parse the tab-separated metrics
  const lines = content.split("\n");
  const metricsStart = lines.findIndex((l) => l.startsWith("JSON Parse\t"));

  let summary: MetricSummary = {
    json_parse_pct: 0,
    compile_success_pct: 0,
    mesh_valid_pct: 0,
    bbox_match_pct: 0,
    avg_feature_score: 0,
    avg_latency_s: 0,
    avg_llm_calls: 0,
    total_cases: 0,
    passed_cases: 0,
    pass_rate_pct: 0,
  };

  if (metricsStart >= 0) {
    const metricNames = [
      "JSON Parse",
      "Compile Success",
      "Mesh Valid",
      "BBox Match",
      "Avg Feature Score",
      "Avg Latency",
      "Avg LLM Calls",
    ];

    for (let i = 0; i < metricNames.length; i++) {
      const line = lines[metricsStart + i];
      if (!line) break;
      const parts = line.split("\t");
      const val = parts[1]?.replace("%", "").replace("s", "");

      switch (i) {
        case 0:
          summary.json_parse_pct = parseFloat(val) || 0;
          break;
        case 1:
          summary.compile_success_pct = parseFloat(val) || 0;
          break;
        case 2:
          summary.mesh_valid_pct = parseFloat(val) || 0;
          break;
        case 3:
          summary.bbox_match_pct = parseFloat(val) || 0;
          break;
        case 4:
          summary.avg_feature_score = parseFloat(val) || 0;
          break;
        case 5:
          summary.avg_latency_s = parseFloat(val) || 0;
          break;
        case 6:
          summary.avg_llm_calls = parseFloat(val) || 0;
          break;
      }
    }
  }

  // Count cases
  const caseLines = lines.filter((l) => l.startsWith("PASS\t") || l.startsWith("FAIL\t"));
  summary.total_cases = caseLines.length;
  summary.passed_cases = caseLines.filter((l) => l.startsWith("PASS\t")).length;
  summary.pass_rate_pct =
    summary.total_cases > 0
      ? Math.round((summary.passed_cases / summary.total_cases) * 100)
      : 0;

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("Report parsing failed:", err);
  process.exit(1);
});
