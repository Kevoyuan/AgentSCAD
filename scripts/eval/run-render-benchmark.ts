#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import openScadPolicy from "../../config/openscad-wasm-runtime.json";

type Status = "PASS" | "FAIL" | "ERROR" | "NOT_RUN";

interface RenderEvidence {
  name: string;
  required: boolean;
  status: Status;
  duration_ms: number;
  source: string;
  value?: unknown;
  reason?: string;
  error?: string;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds3 {
  x: number;
  y: number;
  z: number;
}

const FIXTURE_ID = "wasm-washer-smoke";
const EXPECTED_BBOX: [number, number, number] = [20, 20, 2];
const BBOX_TOLERANCE_MM = 0.25;
const SCAD_SOURCE = `outer_diameter = 20;
inner_diameter = 8;
thickness = 2;

module generated_part() {
  difference() {
    cylinder(d = outer_diameter, h = thickness, center = true, $fn = 64);
    cylinder(d = inner_diameter, h = thickness + 0.2, center = true, $fn = 48);
  }
}

generated_part();
`;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readPoint(view: DataView, offset: number): Point3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

export function inspectBinaryStlBounds(buffer: Buffer): {
  triangleCount: number;
  bbox: Bounds3;
} {
  if (buffer.length < 84) throw new Error("STL is shorter than its binary header");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount <= 0 || 84 + triangleCount * 50 > buffer.length) {
    throw new Error("STL has an invalid binary triangle table");
  }

  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = 84 + triangle * 50 + 12;
    for (const point of [readPoint(view, base), readPoint(view, base + 12), readPoint(view, base + 24)]) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) {
        throw new Error("STL contains a non-finite vertex");
      }
      min.x = Math.min(min.x, point.x);
      min.y = Math.min(min.y, point.y);
      min.z = Math.min(min.z, point.z);
      max.x = Math.max(max.x, point.x);
      max.y = Math.max(max.y, point.y);
      max.z = Math.max(max.z, point.z);
    }
  }
  return {
    triangleCount,
    bbox: {
      x: Math.round((max.x - min.x) * 1_000) / 1_000,
      y: Math.round((max.y - min.y) * 1_000) / 1_000,
      z: Math.round((max.z - min.z) * 1_000) / 1_000,
    },
  };
}

export function bboxMatches(
  actual: Bounds3,
  expected: [number, number, number],
  toleranceMm: number,
): boolean {
  return [actual.x, actual.y, actual.z].every(
    (value, index) => Math.abs(value - expected[index]) <= toleranceMm,
  );
}

function emptyEvidence(name: string, required: boolean): RenderEvidence {
  return { name, required, status: "NOT_RUN", duration_ms: 0, source: "none" };
}

export async function runRenderBenchmark(projectRoot = process.cwd()) {
  const startedAt = performance.now();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscad-render-benchmark-"));
  const previousBackend = process.env.AGENTSCAD_OPENSCAD_BACKEND;
  const previousArtifactRoot = process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
  process.env.AGENTSCAD_OPENSCAD_BACKEND = "wasm";
  process.env.AGENTSCAD_ARTIFACT_WORK_DIR = temporaryRoot;

  const evidence: RenderEvidence[] = [
    emptyEvidence("scad_compile", true),
    emptyEvidence("binary_stl_structure", true),
    emptyEvidence("bbox_match", true),
    emptyEvidence("png_preview", true),
    emptyEvidence("manifold_mesh", false),
    emptyEvidence("visual_fidelity", false),
  ];
  let artifacts: Record<string, unknown> = {
    scad: "NOT_RUN",
    stl: "NOT_RUN",
    png: "NOT_RUN",
  };

  try {
    const renderStartedAt = performance.now();
    const { renderScadArtifacts } = await import("@/lib/tools/scad-renderer");
    const rendered = await renderScadArtifacts(FIXTURE_ID, SCAD_SOURCE);
    const renderDuration = performance.now() - renderStartedAt;
    const stl = await fs.readFile(rendered.stlFilePath);
    const png = await fs.readFile(rendered.pngFilePath);
    const inspected = inspectBinaryStlBounds(stl);

    evidence[0] = {
      name: "scad_compile",
      required: true,
      status: "PASS",
      duration_ms: Math.round(renderDuration * 100) / 100,
      source: "src/lib/tools/scad-renderer.ts#renderScadArtifacts",
      value: { openscad_version: rendered.renderLog.openscad_version },
    };
    evidence[1] = {
      name: "binary_stl_structure",
      required: true,
      status: "PASS",
      duration_ms: 0,
      source: "binary STL triangle table and finite vertex scan",
      value: { triangle_count: inspected.triangleCount },
    };
    evidence[2] = {
      name: "bbox_match",
      required: true,
      status: bboxMatches(inspected.bbox, EXPECTED_BBOX, BBOX_TOLERANCE_MM) ? "PASS" : "FAIL",
      duration_ms: 0,
      source: "measured binary STL vertices",
      value: { actual_mm: inspected.bbox, expected_mm: EXPECTED_BBOX, tolerance_mm: BBOX_TOLERANCE_MM },
    };
    evidence[3] = {
      name: "png_preview",
      required: true,
      status: png.length > 8 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "PASS"
        : "FAIL",
      duration_ms: 0,
      source: "rendered PNG signature",
      value: { bytes: png.length },
    };
    evidence[4] = {
      ...evidence[4],
      reason: "This bounded render benchmark validates finite STL structure, not watertight/manifold topology. Use the mesh-validator integration for that claim.",
    };
    evidence[5] = {
      ...evidence[5],
      reason: "No vision model was invoked; preview existence is not semantic fidelity.",
    };
    artifacts = {
      scad: "PASS",
      stl: "PASS",
      png: evidence[3].status,
      scad_sha256: sha256(SCAD_SOURCE),
      stl_sha256: sha256(stl),
      png_sha256: sha256(png),
      stl_bytes: stl.length,
      png_bytes: png.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const firstPending = evidence.findIndex((item) => item.required && item.status === "NOT_RUN");
    if (firstPending >= 0) {
      evidence[firstPending] = { ...evidence[firstPending], status: "ERROR", error: message };
    }
  } finally {
    if (previousBackend === undefined) delete process.env.AGENTSCAD_OPENSCAD_BACKEND;
    else process.env.AGENTSCAD_OPENSCAD_BACKEND = previousBackend;
    if (previousArtifactRoot === undefined) delete process.env.AGENTSCAD_ARTIFACT_WORK_DIR;
    else process.env.AGENTSCAD_ARTIFACT_WORK_DIR = previousArtifactRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  const required = evidence.filter((item) => item.required);
  const gatePassed = required.every((item) => item.status === "PASS");
  return {
    schema_version: "agentscad.render-eval.v1",
    run_id: randomUUID(),
    created_at: new Date().toISOString(),
    mode: "deterministic-render",
    fixture: {
      id: FIXTURE_ID,
      scad_sha256: sha256(SCAD_SOURCE),
      expected_bbox_mm: EXPECTED_BBOX,
    },
    provenance: {
      runtime: `bun ${Bun.version}`,
      platform: process.platform,
      arch: process.arch,
      openscad_backend: "wasm",
      openscad_version: openScadPolicy.version,
      model: "NOT_RUN",
      provider: "NOT_RUN",
    },
    gate_passed: gatePassed,
    duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
    evidence,
    artifacts,
    usage: { llm_calls: 0, tokens: 0, estimated_cost_usd: 0 },
    project: path.basename(projectRoot),
  };
}

function formatReport(report: Awaited<ReturnType<typeof runRenderBenchmark>>): string {
  const lines = [
    "AgentSCAD deterministic render benchmark",
    `schema: ${report.schema_version}`,
    `fixture: ${report.fixture.id}`,
    `gate: ${report.gate_passed ? "PASS" : "FAIL"}`,
    `duration: ${report.duration_ms.toFixed(2)}ms`,
    `OpenSCAD: ${report.provenance.openscad_version} (${report.provenance.openscad_backend})`,
    "evidence:",
  ];
  for (const item of report.evidence) {
    const detail = "reason" in item ? item.reason : "error" in item ? item.error : undefined;
    lines.push(`  ${item.status.padEnd(7)} ${item.name}${item.required ? " (required)" : ""}${detail ? `: ${detail}` : ""}`);
  }
  lines.push("usage: calls=0; tokens=0; cost=$0.000000");
  return lines.join("\n");
}

if (import.meta.main) {
  const report = await runRenderBenchmark();
  const reportPath = path.join(process.cwd(), "benchmark-render-results.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${formatReport(report)}\n\nJSON evidence report: ${reportPath}\n`);
  process.exitCode = report.gate_passed ? 0 : 1;
}
