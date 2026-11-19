/**
 * L5a 90-degree V-twin cross-section: two cylinder axes at +/-45 degrees share
 * one crankpin. This is the V-angle rung, not a complete V8.
 *
 * Slider centres are measured from rendered mesh bounds and compared with the
 * shared-pin closure along each inclined axis; all six meshes are pairwise
 * tested at nine crank angles. The frame is two guide tubes plus a base, not a
 * complete crankcase.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { meshesIntersect } from "../../src/lib/geometry/mesh-collision";
import { renderAssemblyParts, type RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import {
  aggregateStatus,
  expectedOutcome,
  type BenchRequirement,
  type EvidenceStatus,
  type ExpectedOutcome,
  type Submission,
} from "../assembly/bench";

export interface VTwinSelectors {
  frame: string;
  crank: string;
  rodLeft: string;
  rodRight: string;
  sliderLeft: string;
  sliderRight: string;
}

export interface VTwinContract {
  crankRadiusMm: number;
  rodLengthMm: number;
  vHalfAngleDeg: number;
  bankYmm: number;
  sliderToleranceMm: number;
}

export interface VTwinBenchTask {
  schemaVersion: 1;
  id: string;
  prompt: string;
  selectors: VTwinSelectors;
  motionParameter: string;
  angles: number[];
  contract: VTwinContract;
  requirements: BenchRequirement[];
  notes?: string[];
}

export interface VTwinCaseMeasurements {
  parts: Array<{ partId: string; sha256: string; triangleCount: number; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
  angles: number[];
  sliderCenters: Array<{ angleDeg: number; left: [number, number, number]; right: [number, number, number]; leftExpected: [number, number, number]; rightExpected: [number, number, number] }>;
  maxPositionErrorMm: number | null;
  collision: { sampled: number; separated: number; firstFailure: string | null };
}

export interface VTwinCaseReport {
  schemaVersion: "vtwin-bench.case.v1";
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
  measurements: VTwinCaseMeasurements;
  provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string };
  unknowns: string[];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}
function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(`${field} must be an identifier`);
  return value;
}
export function validateVTwinTask(value: unknown): VTwinBenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("task.schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("task.id must be a lowercase kebab-case id");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("task.prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("task.selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const roles = ["frame", "crank", "rodLeft", "rodRight", "sliderLeft", "sliderRight"] as const;
  if (Object.keys(s).sort().join(",") !== [...roles].sort().join(",")) fail("task.selectors must name exactly frame, crank, rodLeft, rodRight, sliderLeft, sliderRight");
  const selectors = Object.fromEntries(roles.map((role) => [role, identifier(s[role], `task.selectors.${role}`)])) as unknown as VTwinSelectors;
  if (new Set(Object.values(selectors)).size !== 6) fail("task.selectors must be six distinct selectors");
  if (typeof raw.motionParameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.motionParameter)) fail("task.motionParameter must be a SCAD identifier");
  if (["agentscad_part", "agentscad_pose"].includes(raw.motionParameter)) fail("task.motionParameter must not be a reserved control");
  if (!Array.isArray(raw.angles) || raw.angles.length < 3 || raw.angles.length > 24) fail("task.angles must have 3 to 24 entries");
  const angles = raw.angles.map((item) => finite(item, "task.angles[]"));
  if (new Set(angles).size !== angles.length) fail("task.angles must be distinct");
  if (!angles.includes(0)) fail("task.angles must include 0");
  if (!raw.contract || typeof raw.contract !== "object") fail("task.contract must be an object");
  const c = raw.contract as Record<string, unknown>;
  const contract: VTwinContract = {
    crankRadiusMm: finite(c.crankRadiusMm, "task.contract.crankRadiusMm"),
    rodLengthMm: finite(c.rodLengthMm, "task.contract.rodLengthMm"),
    vHalfAngleDeg: finite(c.vHalfAngleDeg, "task.contract.vHalfAngleDeg"),
    bankYmm: finite(c.bankYmm, "task.contract.bankYmm"),
    sliderToleranceMm: finite(c.sliderToleranceMm, "task.contract.sliderToleranceMm"),
  };
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > contract.crankRadiusMm)) fail("crank/rod dimensions are invalid");
  if (!(contract.vHalfAngleDeg > 0) || !(contract.vHalfAngleDeg < 90)) fail("vHalfAngleDeg must be in (0,90)");
  if (!(contract.bankYmm > 0)) fail("task.contract.bankYmm must be positive");
  if (!(contract.sliderToleranceMm > 0)) fail("task.contract.sliderToleranceMm must be positive");
  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("task.requirements must be non-empty");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.requirements[${index}] must be an object`);
    const requirement = entry as Record<string, unknown>;
    if (typeof requirement.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(requirement.id)) fail(`task.requirements[${index}].id is invalid`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(requirement.layer))) fail(`task.requirements[${index}].layer is invalid`);
    if (typeof requirement.required !== "boolean" || typeof requirement.applicable !== "boolean") fail(`task.requirements[${index}] flags are invalid`);
    const expected = requirement.expected as Record<string, unknown> | undefined;
    if (!expected || typeof expected !== "object" || expected.kind !== "equals" || !["string", "boolean", "number"].includes(typeof expected.value)) fail(`task.requirements[${index}].expected must be an exact primitive`);
    if (typeof expected.value === "number" && !Number.isFinite(expected.value)) fail(`task.requirements[${index}].expected.value must be finite`);
    return { id: requirement.id, layer: requirement.layer as BenchRequirement["layer"], required: requirement.required, applicable: requirement.applicable, expected: { kind: "equals", value: expected.value as string | boolean | number } };
  });
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) fail("task.requirements ids must be unique");
  const observable = new Set(["distinct-exported-parts", "measured-joint-frames", "sampled-motion", "source-motion"]);
  for (const requirement of requirements) if (!observable.has(requirement.id)) fail(`task.requirements id "${requirement.id}" has no observer`);
  const distinct = requirements.find((requirement) => requirement.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 6) fail("task.requirements must require distinct-exported-parts = 6");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors, motionParameter: raw.motionParameter, angles, contract, requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}

export function vtwinTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function vtwinSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadVTwinTasks(root = vtwinTasksDirectory()): Promise<VTwinBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: VTwinBenchTask[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(root, name), "utf8"));
    try { tasks.push(validateVTwinTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (tasks.length === 0) fail(`no V-twin tasks found under ${root}`);
  return tasks;
}
export async function loadVTwinSubmissions(taskId: string, root = vtwinSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId);
  let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => {
    const sourcePath = path.join(directory, name);
    return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") };
  }));
}
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
export function expectedVTwinCenter(task: VTwinContract, angleDeg: number, side: "left" | "right"): [number, number, number] {
  const half = task.vHalfAngleDeg * Math.PI / 180;
  const ux = Math.sin(half);
  const uz = Math.cos(half);
  const sx = side === "left" ? ux : -ux;
  const theta = angleDeg * Math.PI / 180;
  const px = task.crankRadiusMm * Math.sin(theta);
  const pz = task.crankRadiusMm * Math.cos(theta);
  const along = px * sx + pz * uz;
  const s = along + Math.sqrt(task.rodLengthMm ** 2 - (px * px + pz * pz - along ** 2));
  return [s * sx, side === "left" ? -task.bankYmm : task.bankYmm, s * uz];
}

export async function scoreVTwinSubmission(task: VTwinBenchTask, submission: Submission): Promise<VTwinCaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = {
    createdAt: new Date().toISOString(),
    backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
    openscad: openscadVersion(),
    runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
    platform: process.platform,
  };
  const unknowns = [
    "A PASS covers nine listed crank angles and pairwise triangle collision; it is not continuous motion, load, lubrication, wear or physical function.",
    "This is a 90-degree V-twin cross-section, not a complete V8. The frame is two inclined guide tubes plus a base, not a complete crankcase.",
    "Slider centres come from mesh bounds, not independently identified pin/bore features; the 0.1 mm tolerance is a mesh value.",
  ];
  const empty: VTwinCaseMeasurements = { parts: [], angles: task.angles, sliderCenters: [], maxPositionErrorMm: null, collision: { sampled: 0, separated: 0, firstFailure: null } };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: VTwinCaseMeasurements): VTwinCaseReport => {
    const scored = scoreEvidence(results.map((result) => ({ id: result.id, status: result.status })));
    return {
      schemaVersion: "vtwin-bench.case.v1", taskId: task.id, submission: submission.id,
      expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256,
      status, gatePassed: status === "PASS", results,
      layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) },
      measurements, provenance, unknowns,
    };
  };
  const blocked = (reason: string): VTwinCaseReport => {
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id, layer: requirement.layer, required: requirement.required, status: requirement.applicable ? "ERROR" : "SKIP",
      reason, observation: { id: requirement.id, status: "ERROR", reason },
    }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  const partIds = Object.keys(task.selectors) as Array<keyof VTwinSelectors>;
  const renderParts = (angle: number) => renderAssemblyParts({ scadSource: submission.source, parameters: { [task.motionParameter]: angle }, parts: partIds.map((role) => ({ partId: role, selector: task.selectors[role] })) });
  let zeroParts: RenderedAssemblyPart[];
  try { zeroParts = await renderParts(0); } catch (error) { return blocked(`The six instance meshes did not render at 0°: ${error instanceof Error ? error.message : String(error)}`); }
  const zeroMeshes = zeroParts.map((part) => ({ part, mesh: readBinaryStl(part.stl) }));
  const measurements: VTwinCaseMeasurements = {
    ...empty,
    parts: zeroMeshes.map(({ part, mesh }) => ({ partId: part.partId, sha256: part.sha256, triangleCount: part.triangleCount, bounds: meshBounds(mesh) })),
  };
  const artifactSha256 = sha256(zeroParts.map((part) => part.sha256).join(":"));
  const distinct = new Set(zeroMeshes.map(({ mesh }) => canonicalMeshHash(mesh))).size;
  let collisionSampled = 0;
  let collisionSeparated = 0;
  let firstFailure: string | null = null;
  let maxPositionError = 0;
  const centerOf = (parts: RenderedAssemblyPart[], partId: string) => {
    const part = parts.find((entry) => entry.partId === partId);
    if (!part) throw new Error(`missing part ${partId}`);
    const b = meshBounds(readBinaryStl(part.stl));
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as [number, number, number];
  };
  for (const angle of task.angles) {
    let parts: RenderedAssemblyPart[];
    try { parts = angle === 0 ? zeroParts : await renderParts(angle); } catch (error) { return blocked(`The six instance meshes did not render at ${angle}°: ${error instanceof Error ? error.message : String(error)}`); }
    const left = centerOf(parts, "sliderLeft");
    const right = centerOf(parts, "sliderRight");
    const leftExpected = expectedVTwinCenter(task.contract, angle, "left");
    const rightExpected = expectedVTwinCenter(task.contract, angle, "right");
    measurements.sliderCenters.push({ angleDeg: angle, left, right, leftExpected, rightExpected });
    for (const [actual, expected] of [[left, leftExpected] as const, [right, rightExpected] as const]) {
      maxPositionError = Math.max(maxPositionError, Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]));
    }
    const meshes = parts.map((part) => readBinaryStl(part.stl));
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        collisionSampled += 1;
        const result = meshesIntersect(meshes[i], IDENTITY, meshes[j], IDENTITY);
        if (result.status === "SEPARATED") collisionSeparated += 1;
        else if (!firstFailure) firstFailure = `${angle}° ${parts[i].partId}/${parts[j].partId}:${result.status}`;
      }
    }
  }
  measurements.maxPositionErrorMm = maxPositionError;
  measurements.collision = { sampled: collisionSampled, separated: collisionSeparated, firstFailure };
  const positionOk = maxPositionError <= task.contract.sliderToleranceMm;
  const collisionOk = collisionSampled > 0 && collisionSeparated === collisionSampled;
  const toolVersion = `vtwin-bench/1 openscad:${openscadVersion()}`;
  const distinctObservation: Observation = {
    id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256,
    method: "Canonical order-independent triangle hash per rendered instance mesh.", toolVersion,
    coverage: `${zeroParts.length} instance mesh(es): ${zeroParts.map((part) => part.partId).join(", ")}.`,
    ...(distinct === zeroParts.length ? {} : { reason: `Only ${distinct} distinct instance meshes across ${zeroParts.length} selectors.` }),
  };
  const framesObservation: Observation = {
    id: "measured-joint-frames", status: "MEASURED", value: positionOk, artifactSha256,
    method: "Slider centres from mesh bounds compared with the shared-pin closure projected on each +/-45-degree cylinder axis.", toolVersion,
    coverage: `${task.angles.length} angles; both banks; tolerance ${task.contract.sliderToleranceMm} mm.`,
    ...(positionOk ? {} : { reason: `Slider centre error ${maxPositionError.toFixed(4)} mm exceeds ${task.contract.sliderToleranceMm} mm.` }),
  };
  const collisionObservation: Observation = {
    id: "sampled-motion", status: "MEASURED", value: collisionOk, artifactSha256,
    method: "All 15 pairs of the six rendered instance meshes at every listed angle; BVH triangle intersection.", toolVersion,
    coverage: `${task.angles.length} angles, ${collisionSampled} pair checks.`,
    ...(collisionOk ? {} : { reason: firstFailure ?? "A collision pair was not sampled." }),
  };
  const sourceObservation: Observation = {
    id: "source-motion", status: "MEASURED", value: positionOk, artifactSha256,
    method: "Actual source re-render at every angle; both sliders compared with the shared-pin closure, so a static or wrong-angle source fails.", toolVersion,
    coverage: `${task.angles.length} angles; V half-angle ${task.contract.vHalfAngleDeg}°.`,
    ...(positionOk ? {} : { reason: `Source-driven V-twin positions do not follow the declared shared-pin closure: max error ${maxPositionError.toFixed(4)} mm.` }),
  };
  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation,
    "measured-joint-frames": framesObservation,
    "sampled-motion": collisionObservation,
    "source-motion": sourceObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") {
      return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    }
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
