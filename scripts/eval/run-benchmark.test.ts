import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildReport,
  deriveCaseStatus,
  formatReport,
  loadBenchmarkCases,
  normalizeBenchmarkCase,
  runSingleBenchmark,
  type EvidenceFact,
} from "./run-benchmark";
import { parseEvalReport } from "./report";

describe("truthful CAD evaluator", () => {
  test("never reports unexecuted geometry facts as PASS", async () => {
    const benchmark = normalizeBenchmarkCase({
      id: "truthful-offline",
      prompt: "Create a washer",
      difficulty: "simple",
      expected_part_type: "washer",
      required_features: ["center hole"],
      expected_bbox: [20, 20, 2],
    }, "inline.json");

    const result = await runSingleBenchmark(benchmark);
    for (const name of ["llm_generation", "scad_compile", "mesh_validity", "bbox_match", "visual_fidelity"]) {
      expect(result.evidence.find((item) => item.name === name)?.status).toBe("NOT_RUN");
    }
    expect(result.artifacts).toEqual({
      scad: "NOT_RUN",
      stl: "NOT_RUN",
      views: "NOT_RUN",
      validation_report: "NOT_RUN",
    });
  });

  test("a required NOT_RUN fact fails the gate without being rewritten to FAIL", () => {
    const evidence = [
      { name: "fixture_parse", status: "PASS", required: true },
      { name: "intent_ambiguity", status: "NOT_RUN", required: true },
    ] as EvidenceFact[];
    expect(deriveCaseStatus(evidence)).toBe("NOT_RUN");
  });

  test("loads the frozen planetary-engine ambiguity contract", async () => {
    const cases = await loadBenchmarkCases();
    const benchmark = cases.find((item) => item.id === "planetary-engine-ambiguity");
    expect(benchmark?.suite).toBe("frozen");
    expect(benchmark?.expected_intent?.status).toBe("AMBIGUOUS");
    expect(benchmark?.expected_intent?.interpretations.map((item) => item.id)).toEqual([
      "planetary_propulsion_megastructure",
      "planetary_gear_motor",
    ]);
    expect(benchmark?.expected_intent?.clarification_question).toBe(
      "你指的是行星推进用的科幻巨型发动机，还是行星齿轮电机/减速机构？",
    );
  });

  test("single-case output compares the expected brief with observed product evidence", async () => {
    const cases = await loadBenchmarkCases();
    const benchmark = cases.find((item) => item.id === "planetary-engine-ambiguity");
    if (!benchmark) throw new Error("frozen case missing");
    const result = await runSingleBenchmark(benchmark);
    const report = buildReport([result], { caseId: benchmark.id, totalDurationMs: 1 });
    const output = formatReport(report);
    expect(result.status).toBe("PASS");
    expect(report.summary.gate_passed).toBe(true);
    expect(output).toContain("expected brief: AMBIGUOUS");
    expect(output).toContain("observed brief: AMBIGUOUS");
    expect(output).toContain("expected question: 你指的是行星推进用的科幻巨型发动机");
    expect(output).toContain("observed question: 你指的是行星推进用的科幻巨型发动机");
    expect(output).toContain("intent_ambiguity (required)");
    expect(output).toContain("artifacts: scad=NOT_RUN stl=NOT_RUN views=NOT_RUN");
  });

  test("JSON report parser rejects the legacy synthetic text format", async () => {
    expect(() => parseEvalReport("Compile Success\t100%\nMesh Valid\t100%"))
      .toThrow("not valid JSON");

    const fixture = await fs.readFile(
      path.join(process.cwd(), "benchmarks", "frozen", "planetary-engine-ambiguity.json"),
      "utf8",
    );
    expect(JSON.parse(fixture).schema_version).toBe(1);
  });
});
