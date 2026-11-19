/**
 * A single-cylinder slider-crank family for the public assembly benchmark.
 *
 * The task owns the mechanism contract: crank radius, rod length, section,
 * pin/bore radius windows, sampled input angles and selectors. The submission
 * owns geometry only. The scorer re-renders the complete source at every listed
 * angle and measures the actual contours, the traced crank circle, the rod
 * length and the pin-axis drift; collisions are checked on the full selected
 * meshes. Nothing is read from the source's own variables as evidence.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import type { SliderCrankGeometryContract } from "../../src/lib/assembly/slider-crank-geometry";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import type { RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
import { sampleSliderCrankSource } from "../../src/lib/tools/slider-crank-measurement";
import { scoreEvidence } from "../layers";
import {
  aggregateStatus,
  expectedOutcome,
  type BenchRequirement,
  type EvidenceStatus,
  type ExpectedOutcome,
  type Submission,
} from "../assembly/bench";

export interface SliderSelectors {
  crank: string;
  rod: string;
  slider: string;
  frame: string;
}

export interface SliderBenchTask {
  schemaVersion: 1;
  id: string;
  prompt: string;
  selectors: SliderSelectors;
  motionParameter: string;
  poseParameters: Record<string, number | string | boolean>;
  angles: number[];
  contract: SliderCrankGeometryContract;
  requirements: BenchRequirement[];
  notes?: string[];
}

export interface SliderCaseMeasurements {
  parts: Array<{ partId: string; sha256: string; triangleCount: number; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
  angles: number[];
  landmarkStatus: string;
  collisionStatus: string;
  motionStatus: string;
  collisionSamples: Array<{ angleDegrees: number; status: string; trianglePairs: number }>;
  crankRadiusMm: number | null;
  crankResidualMm: number | null;
  rodLengthSpreadMm: number | null;
  axisDriftMm: number | null;
}

export interface SliderCaseReport {
  schemaVersion: "slider-bench.case.v1";
  taskId: string;
  submission: string;
  expected: ExpectedOutcome;
  sourcePath: string;
  sourceSha256: string;
  status: EvidenceStatus;
  gatePassed: boolean;
  results: Result[];
  layers: {
    coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] };
    byLayer: Array<{ layer: string; status: string | null; blockers: string[] }>;
  };
  measurements: SliderCaseMeasurements;
  provenance: {
    createdAt: string;
    backend: string;
    openscad: string;
    runtime: string;
    platform: string;
  };
  unknowns: string[];
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function fail(message: string): never {
  throw new Error(message);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}

function radiusWindow(value: unknown, field: string) {
  if (!value || typeof value !== "object") fail(`${field} must be an object`);
  const raw = value as Record<string, unknown>;
  const min = finite(raw.min, `${field}.min`);
  const max = finite(raw.max, `${field}.max`);
  if (!(min > 0) || max < min) fail(`${field} must satisfy 0 < min <= max`);
  return { min, max };
}

/** A malformed task is rejected before any geometry is rendered. */
export function validateSliderTask(value: unknown): SliderBenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("task.schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("task.id must be a lowercase kebab-case id");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("task.prompt must be a non-trivial string");

  if (!raw.selectors || typeof raw.selectors !== "object") fail("task.selectors must be an object");
  const selectorsRaw = raw.selectors as Record<string, unknown>;
  const roles = ["crank", "rod", "slider", "frame"] as const;
  if (Object.keys(selectorsRaw).sort().join(",") !== [...roles].sort().join(",")) fail("task.selectors must name exactly crank, rod, slider and frame");
  const selectors = Object.fromEntries(roles.map((role) => {
    const selector = selectorsRaw[role];
    if (typeof selector !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(selector)) fail(`task.selectors.${role} is invalid`);
    return [role, selector];
  })) as unknown as SliderSelectors;
  if (new Set(Object.values(selectors)).size !== 4) fail("task.selectors must be four distinct selectors");

  if (typeof raw.motionParameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.motionParameter)) fail("task.motionParameter must be a SCAD identifier");
  if (["agentscad_part", "agentscad_pose"].includes(raw.motionParameter)) fail("task.motionParameter must not be a reserved control");

  if (!raw.poseParameters || typeof raw.poseParameters !== "object" || Array.isArray(raw.poseParameters)) fail("task.poseParameters must be an object");
  const poseParameters: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(raw.poseParameters as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) fail(`task.poseParameters key "${key}" is invalid`);
    if (!["string", "number", "boolean"].includes(typeof value)) fail(`task.poseParameters.${key} must be a primitive`);
    poseParameters[key] = value as number | string | boolean;
  }
  if (Object.hasOwn(poseParameters, raw.motionParameter)) fail("task.poseParameters must not set the motion parameter");

  if (!Array.isArray(raw.angles) || raw.angles.length < 3 || raw.angles.length > 24) fail("task.angles must have 3 to 24 entries");
  const angles = raw.angles.map((item) => finite(item, "task.angles[]"));
  if (new Set(angles).size !== angles.length) fail("task.angles must be distinct");
  if (!angles.includes(0)) fail("task.angles must include 0, the assembled pose");

  if (!raw.contract || typeof raw.contract !== "object") fail("task.contract must be an object");
  const contractRaw = raw.contract as Record<string, unknown>;
  const contract: SliderCrankGeometryContract = {
    crankRadiusMm: finite(contractRaw.crankRadiusMm, "task.contract.crankRadiusMm"),
    rodLengthMm: finite(contractRaw.rodLengthMm, "task.contract.rodLengthMm"),
    toleranceMm: finite(contractRaw.toleranceMm, "task.contract.toleranceMm"),
    sectionYmm: finite(contractRaw.sectionYmm, "task.contract.sectionYmm"),
    pinRadiusMm: radiusWindow(contractRaw.pinRadiusMm, "task.contract.pinRadiusMm"),
    rodBoreRadiusMm: radiusWindow(contractRaw.rodBoreRadiusMm, "task.contract.rodBoreRadiusMm"),
    ...(contractRaw.axisProbeMm !== undefined ? { axisProbeMm: finite(contractRaw.axisProbeMm, "task.contract.axisProbeMm") } : {}),
  };
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > 0)) fail("crank and rod lengths must be positive");
  if (!(contract.toleranceMm >= 1e-4)) fail("task.contract.toleranceMm must be at least 1e-4");
  if (!(contract.axisProbeMm === undefined || contract.axisProbeMm > 0)) fail("task.contract.axisProbeMm must be positive");

  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("task.requirements must be a non-empty array");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.requirements[${index}] must be an object`);
    const requirement = entry as Record<string, unknown>;
    if (typeof requirement.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(requirement.id)) fail(`task.requirements[${index}].id is invalid`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(requirement.layer))) fail(`task.requirements[${index}].layer is invalid`);
    if (typeof requirement.required !== "boolean") fail(`task.requirements[${index}].required must be boolean`);
    if (typeof requirement.applicable !== "boolean") fail(`task.requirements[${index}].applicable must be boolean`);
    const expected = requirement.expected as Record<string, unknown> | undefined;
    if (!expected || typeof expected !== "object" || expected.kind !== "equals") fail(`task.requirements[${index}].expected must be an exact value`);
    if (!["string", "boolean", "number"].includes(typeof expected.value)) fail(`task.requirements[${index}].expected.value has an unsupported type`);
    if (typeof expected.value === "number" && !Number.isFinite(expected.value)) fail(`task.requirements[${index}].expected.value must be finite`);
    return { id: requirement.id, layer: requirement.layer as BenchRequirement["layer"], required: requirement.required, applicable: requirement.applicable, expected: { kind: "equals", value: expected.value as string | boolean | number } };
  });
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) fail("task.requirements ids must be unique");
  const observable = new Set(["distinct-exported-parts", "measured-joint-frames", "sampled-motion", "source-motion"]);
  for (const requirement of requirements) {
    if (!observable.has(requirement.id)) fail(`task.requirements id "${requirement.id}" has no observer in this slider benchmark`);
  }
  const distinct = requirements.find((requirement) => requirement.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 4) {
    fail("task.requirements must require distinct-exported-parts = 4");
  }

  return {
    schemaVersion: 1,
    id: raw.id,
    prompt: raw.prompt,
    selectors,
    motionParameter: raw.motionParameter,
    poseParameters,
    angles,
    contract,
    requirements,
    ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}),
  };
}

export function sliderTasksDirectory(): string {
  return path.join(import.meta.dir, "tasks");
}

export function sliderSubmissionsDirectory(): string {
  return path.join(import.meta.dir, "submissions");
}

export async function loadSliderTasks(root = sliderTasksDirectory()): Promise<SliderBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: SliderBenchTask[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(root, name), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`${name}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      tasks.push(validateSliderTask(parsed));
    } catch (error) {
      fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (tasks.length === 0) fail(`no slider tasks found under ${root}`);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) fail("slider task ids must be unique");
  return tasks;
}

export async function loadSliderSubmissions(taskId: string, root = sliderSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort();
  } catch {
    return [];
  }
  const submissions: Submission[] = [];
  for (const name of names) {
    const sourcePath = path.join(directory, name);
    submissions.push({
      taskId,
      id: name.replace(/\.scad$/, ""),
      sourcePath,
      source: await readFile(sourcePath, "utf8"),
    });
  }
  return submissions;
}

/** Order-independent triangle hash, so a shuffled STL is not a distinct part. */
function canonicalMeshHash(mesh: TriangleMesh): string {
  const triangles: string[] = [];
  for (let index = 0; index < mesh.triangleCount; index += 1) {
    const corners: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const base = index * 9 + corner * 3;
      corners.push(`${mesh.coordinates[base].toFixed(4)},${mesh.coordinates[base + 1].toFixed(4)},${mesh.coordinates[base + 2].toFixed(4)}`);
    }
    triangles.push(corners.sort().join("|"));
  }
  return sha256(triangles.sort().join("\n"));
}

let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string {
  if (cachedOpenscadVersion !== null) return cachedOpenscadVersion;
  const result = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" });
  cachedOpenscadVersion = result.success ? result.stdout.toString().trim() : "unavailable";
  return cachedOpenscadVersion;
}

function observationStatus(status: string | undefined): Observation["status"] {
  return status === "PASS" || status === "FAIL" ? "MEASURED" : status === "ERROR" ? "ERROR" : "NOT_RUN";
}

export async function scoreSliderSubmission(task: SliderBenchTask, submission: Submission): Promise<SliderCaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = {
    createdAt: new Date().toISOString(),
    backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
    openscad: openscadVersion(),
    runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
    platform: process.platform,
  };
  const unknowns = [
    "A PASS covers exactly the listed input angles and the measured sections at those angles; it is not a proof of continuous motion, a hidden obstruction between samples, load capacity, friction, wear or physical function.",
    "The crank circle, rod length and pin-axis drift are fitted from actual re-rendered meshes; contour identity still depends on the declared selectors and radius windows.",
    "The run does not include disassembly, tool access, manufacturing tolerance or a hidden task set.",
  ];
  const emptyMeasurements: SliderCaseMeasurements = {
    parts: [], angles: task.angles, landmarkStatus: "NOT_RUN", collisionStatus: "NOT_RUN", motionStatus: "NOT_RUN",
    collisionSamples: [], crankRadiusMm: null, crankResidualMm: null, rodLengthSpreadMm: null, axisDriftMm: null,
  };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: SliderCaseMeasurements): SliderCaseReport => {
    const scored = scoreEvidence(results.map((result) => ({ id: result.id, status: result.status })));
    return {
      schemaVersion: "slider-bench.case.v1",
      taskId: task.id,
      submission: submission.id,
      expected: expectedOutcome(submission.id),
      sourcePath: path.relative(process.cwd(), submission.sourcePath),
      sourceSha256,
      status,
      gatePassed: status === "PASS",
      results,
      layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) },
      measurements,
      provenance,
      unknowns,
    };
  };

  let zeroParts: RenderedAssemblyPart[] | null = null;
  let sampled: Awaited<ReturnType<typeof sampleSliderCrankSource>>;
  try {
    sampled = await sampleSliderCrankSource({
      scadSource: submission.source,
      contract: task.contract,
      angles: task.angles,
      motionParameter: task.motionParameter,
      selectors: task.selectors,
      poseParameters: task.poseParameters,
      onArtifacts: async (angle, parts) => {
        if (angle === 0) zeroParts = parts;
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id, layer: requirement.layer, required: requirement.required,
      status: requirement.applicable ? "ERROR" : "SKIP",
      reason: `The slider-crank measurement could not run: ${reason}`,
      observation: { id: requirement.id, status: "ERROR", reason },
    }));
    const report = baseReport(aggregateStatus(results), results, emptyMeasurements);
    report.unknowns = [...unknowns, `Measurement error: ${reason}`];
    return report;
  }

  const measurements: SliderCaseMeasurements = {
    ...emptyMeasurements,
    angles: task.angles,
    landmarkStatus: sampled.landmarkStatus,
    collisionStatus: sampled.collision.status,
    motionStatus: sampled.motion?.status ?? "NOT_RUN",
    collisionSamples: sampled.collision.samples.map((sample) => ({
      angleDegrees: sample.angleDegrees,
      status: sample.status,
      trianglePairs: (sample.pairs ?? []).reduce((sum, pair) => sum + (pair.result.testedPairs ?? 0), 0),
    })),
    crankRadiusMm: sampled.motion?.crank?.radiusMm ?? null,
    crankResidualMm: sampled.motion?.crank?.residualMm ?? null,
    rodLengthSpreadMm: sampled.motion?.rodLengthMm?.spread ?? null,
    axisDriftMm: sampled.motion?.axisDriftMm ?? null,
  };

  const parts = zeroParts as RenderedAssemblyPart[] | null;
  if (parts) {
    measurements.parts = parts.map((part) => {
      const mesh = readBinaryStl(part.stl);
      const bounds = meshBounds(mesh);
      return { partId: part.partId, sha256: part.sha256, triangleCount: part.triangleCount, bounds };
    });
  }
  const partArtifact = parts ? sha256(parts.map((part) => part.sha256).join(":")) : sourceSha256;
  const distinctCount = parts ? new Set(parts.map((part) => canonicalMeshHash(readBinaryStl(part.stl)))).size : 0;
  const distinctObservation: Observation = parts
    ? {
        id: "distinct-exported-parts", status: "MEASURED", value: distinctCount,
        artifactSha256: partArtifact, method: "Canonical order-independent triangle hash per rendered mechanism part.",
        toolVersion: `slider-bench/1 openscad:${openscadVersion()}`,
        coverage: `${parts.length} rendered part(s): ${parts.map((part) => `${part.partId}=${part.triangleCount} triangles`).join(", ")}.`,
        ...(distinctCount === parts.length ? {} : { reason: `Only ${distinctCount} distinct solid(s) across ${parts.length} selectors.` }),
      }
    : { id: "distinct-exported-parts", status: "NOT_RUN", reason: "No rendered parts at the assembled pose.", toolVersion: "slider-bench/1" };

  const firstNonPass = (items: Array<{ status: string; reason?: string }>) => items.find((item) => item.status !== "PASS");
  const toolVersion = `slider-bench/1 openscad:${openscadVersion()}`;
  const landmarkObservation: Observation = {
    id: "measured-joint-frames",
    status: observationStatus(sampled.landmarkStatus),
    value: sampled.landmarkStatus === "PASS",
    artifactSha256: partArtifact,
    method: "Circular-section landmark comparison against the frozen crank/rod/slider oracle at every listed angle.",
    toolVersion,
    coverage: sampled.coverage,
    ...(sampled.landmarkStatus === "PASS" ? {} : { reason: firstNonPass(sampled.samples)?.reason ?? "A landmark pose did not pass." }),
  };
  const collisionObservation: Observation = {
    id: "sampled-motion",
    status: observationStatus(sampled.collision.status),
    value: sampled.collision.status === "PASS",
    artifactSha256: partArtifact,
    method: "Full selected mechanism meshes at every listed angle, with pairwise BVH triangle intersection; no allowed-contact exemptions.",
    toolVersion,
    coverage: `${sampled.collision.samples.length} listed angle(s); ${sampled.collision.samples.map((sample) => `${sample.angleDegrees}:${sample.status}`).join(", ")}.`,
    ...(sampled.collision.status === "PASS" ? {} : { reason: firstNonPass(sampled.collision.samples)?.reason ?? "A collision pose did not pass." }),
  };
  const motionStatus = sampled.motion?.status ?? "NOT_RUN";
  const motionCoverage = sampled.motion
    ? typeof sampled.motion.coverage === "string"
      ? sampled.motion.coverage
      : `Cross-pose fit at ${sampled.motion.coverage.poses} pose(s); crank radius ${sampled.motion.crank?.radiusMm?.toFixed(4) ?? "unmeasured"} mm; rod spread ${sampled.motion.rodLengthMm?.spread?.toFixed(4) ?? "unmeasured"} mm; axis drift ${sampled.motion.axisDriftMm?.toFixed(4) ?? "unmeasured"} mm.`
    : "No cross-pose motion evidence.";
  const motionObservation: Observation = {
    id: "source-motion",
    status: observationStatus(motionStatus),
    value: motionStatus === "PASS",
    artifactSha256: partArtifact,
    method: "Actual source re-render at every listed angle; crank circle fit, rod-length constancy and pin-axis parallelism from the rendered meshes.",
    toolVersion,
    coverage: motionCoverage,
    ...(motionStatus === "PASS" ? {} : { reason: (sampled.motion?.failures ?? [sampled.motion?.reason ?? "Cross-pose motion did not run."]).join(" ") }),
  };

  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation,
    "measured-joint-frames": landmarkObservation,
    "sampled-motion": collisionObservation,
    "source-motion": motionObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement(
      { id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected },
      observations[requirement.id],
    );
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") {
      const observed = observations[requirement.id]?.value;
      return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observed)}, expected ${String(requirement.expected.value)}.` };
    }
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
