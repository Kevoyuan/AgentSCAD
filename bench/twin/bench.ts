/**
 * L4.5 inline twin-piston family: two pistons on one Y-axis crank, 180° apart.
 *
 * This is a first multi-cylinder rung, not the V8 V-angle cross-section. The
 * task owns the mechanism contract; the submission owns geometry. Slider centre
 * positions are measured from rendered mesh bounds, collisions from all pairs
 * of six instance meshes, and the source is re-rendered at every listed angle.
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

export interface TwinSelectors {
  frame: string;
  crank: string;
  rodLeft: string;
  rodRight: string;
  sliderLeft: string;
  sliderRight: string;
}

export interface TwinContract {
  crankRadiusMm: number;
  rodLengthMm: number;
  leftYmm: number;
  rightYmm: number;
  phaseDeg: number;
  sliderToleranceMm: number;
}

export interface TwinBenchTask {
  schemaVersion: 1;
  id: string;
  prompt: string;
  selectors: TwinSelectors;
  motionParameter: string;
  angles: number[];
  contract: TwinContract;
  requirements: BenchRequirement[];
  notes?: string[];
}

export interface TwinCaseMeasurements {
  parts: Array<{ partId: string; sha256: string; triangleCount: number; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
  angles: number[];
  sliderPositions: Array<{ angleDeg: number; leftZmm: number; rightZmm: number; leftYmm: number; rightYmm: number }>;
  maxPositionErrorMm: number | null;
  maxYErrorMm: number | null;
  collision: { sampled: number; separated: number; firstFailure: string | null };
}

export interface TwinCaseReport {
  schemaVersion: "twin-bench.case.v1";
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
  measurements: TwinCaseMeasurements;
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

export function validateTwinTask(value: unknown): TwinBenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("task.schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("task.id must be a lowercase kebab-case id");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("task.prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("task.selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const roles = ["frame", "crank", "rodLeft", "rodRight", "sliderLeft", "sliderRight"] as const;
  if (Object.keys(s).sort().join(",") !== [...roles].sort().join(",")) fail("task.selectors must name exactly frame, crank, rodLeft, rodRight, sliderLeft, sliderRight");
  const selectors = Object.fromEntries(roles.map((role) => [role, identifier(s[role], `task.selectors.${role}`)])) as unknown as TwinSelectors;
  if (new Set(Object.values(selectors)).size !== 6) fail("task.selectors must be six distinct selectors");
  if (typeof raw.motionParameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.motionParameter)) fail("task.motionParameter must be a SCAD identifier");
  if (["agentscad_part", "agentscad_pose"].includes(raw.motionParameter)) fail("task.motionParameter must not be a reserved control");
  if (!Array.isArray(raw.angles) || raw.angles.length < 3 || raw.angles.length > 24) fail("task.angles must have 3 to 24 entries");
  const angles = raw.angles.map((item) => finite(item, "task.angles[]"));
  if (new Set(angles).size !== angles.length) fail("task.angles must be distinct");
  if (!angles.includes(0)) fail("task.angles must include 0");
  if (!raw.contract || typeof raw.contract !== "object") fail("task.contract must be an object");
  const c = raw.contract as Record<string, unknown>;
  const contract: TwinContract = {
    crankRadiusMm: finite(c.crankRadiusMm, "task.contract.crankRadiusMm"),
    rodLengthMm: finite(c.rodLengthMm, "task.contract.rodLengthMm"),
    leftYmm: finite(c.leftYmm, "task.contract.leftYmm"),
    rightYmm: finite(c.rightYmm, "task.contract.rightYmm"),
    phaseDeg: finite(c.phaseDeg, "task.contract.phaseDeg"),
    sliderToleranceMm: finite(c.sliderToleranceMm, "task.contract.sliderToleranceMm"),
  };
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > contract.crankRadiusMm)) fail("crank/rod dimensions are invalid");
  if (!(contract.leftYmm < contract.rightYmm)) fail("task.contract.leftYmm must be less than rightYmm");
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

export function twinTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function twinSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadTwinTasks(root = twinTasksDirectory()): Promise<TwinBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: TwinBenchTask[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(root, name), "utf8"));
    try { tasks.push(validateTwinTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (tasks.length === 0) fail(`no twin tasks found under ${root}`);
  return tasks;
}
export async function loadTwinSubmissions(taskId: string, root = twinSubmissionsDirectory()): Promise<Submission[]> {
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
function expectedSliderZ(task: TwinTaskContractInput, angleDeg: number, phaseDeg: number): number {
  const theta = (angleDeg + phaseDeg) * Math.PI / 180;
  const r = task.crankRadiusMm;
  const l = task.rodLengthMm;
  return r * Math.cos(theta) + Math.sqrt(l * l - (r * Math.sin(theta)) ** 2);
}
interface TwinTaskContractInput { crankRadiusMm: number; rodLengthMm: number; }

export async function scoreTwinSubmission(task: TwinBenchTask, submission: Submission): Promise<TwinCaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = {
    createdAt: new Date().toISOString(),
    backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
    openscad: openscadVersion(),
    runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
    platform: process.platform,
  };
  const unknowns = [
    "A PASS covers five listed input angles and pairwise full-mesh collision; it is not continuous motion, load, lubrication, friction, wear or physical function.",
    "This is an inline twin, not the V8 V-angle cross-section. Slider positions are measured from mesh bounds, not an independently identified feature.",
    "The task owns the mechanism contract; the source owns only geometry and the crank-angle parameter.",
  ];
  const empty: TwinCaseMeasurements = {
    parts: [], angles: task.angles, sliderPositions: [], maxPositionErrorMm: null, maxYErrorMm: null,
    collision: { sampled: 0, separated: 0, firstFailure: null },
  };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: TwinCaseMeasurements): TwinCaseReport => {
    const scored = scoreEvidence(results.map((result) => ({ id: result.id, status: result.status })));
    return {
      schemaVersion: "twin-bench.case.v1", taskId: task.id, submission: submission.id,
      expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256,
      status, gatePassed: status === "PASS", results,
      layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) },
      measurements, provenance, unknowns,
    };
  };
  const blocked = (reason: string): TwinCaseReport => {
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id, layer: requirement.layer, required: requirement.required, status: requirement.applicable ? "ERROR" : "SKIP",
      reason, observation: { id: requirement.id, status: "ERROR", reason },
    }));
    return baseReport(aggregateStatus(results), results, empty);
  };

  const partIds = Object.keys(task.selectors) as Array<keyof TwinSelectors>;
  const renderParts = (angle: number) => renderAssemblyParts({
    scadSource: submission.source,
    parameters: { [task.motionParameter]: angle },
    parts: partIds.map((role) => ({ partId: role, selector: task.selectors[role] })),
  });
  let zeroParts: RenderedAssemblyPart[];
  try { zeroParts = await renderParts(0); } catch (error) {
    return blocked(`The six instance meshes did not render at 0°: ${error instanceof Error ? error.message : String(error)}`);
  }
  const zeroMeshes = zeroParts.map((part) => ({ part, mesh: readBinaryStl(part.stl) }));
  const measurements: TwinCaseMeasurements = {
    ...empty,
    parts: zeroMeshes.map(({ part, mesh }) => ({ partId: part.partId, sha256: part.sha256, triangleCount: part.triangleCount, bounds: meshBounds(mesh) })),
  };
  const artifactSha256 = sha256(zeroParts.map((part) => part.sha256).join(":"));
  const distinct = new Set(zeroMeshes.map(({ mesh }) => canonicalMeshHash(mesh))).size;

  let collisionSampled = 0;
  let collisionSeparated = 0;
  let firstFailure: string | null = null;
  let maxPositionError = 0;
  let maxYError = 0;
  const sliderPositions: TwinCaseMeasurements["sliderPositions"] = [];
  const sliderFor = (parts: RenderedAssemblyPart[], partId: string) => {
    const part = parts.find((entry) => entry.partId === partId);
    if (!part) throw new Error(`missing part ${partId}`);
    return meshBounds(readBinaryStl(part.stl));
  };
  for (const angle of task.angles) {
    let parts: RenderedAssemblyPart[];
    try { parts = angle === 0 ? zeroParts : await renderParts(angle); } catch (error) {
      return blocked(`The six instance meshes did not render at ${angle}°: ${error instanceof Error ? error.message : String(error)}`);
    }
    const left = sliderFor(parts, "sliderLeft");
    const right = sliderFor(parts, "sliderRight");
    const leftZ = (left.min[2] + left.max[2]) / 2;
    const rightZ = (right.min[2] + right.max[2]) / 2;
    const leftY = (left.min[1] + left.max[1]) / 2;
    const rightY = (right.min[1] + right.max[1]) / 2;
    sliderPositions.push({ angleDeg: angle, leftZmm: leftZ, rightZmm: rightZ, leftYmm: leftY, rightYmm: rightY });
    maxPositionError = Math.max(maxPositionError, Math.abs(leftZ - expectedSliderZ(task.contract, angle, 0)), Math.abs(rightZ - expectedSliderZ(task.contract, angle, task.contract.phaseDeg)));
    maxYError = Math.max(maxYError, Math.abs(leftY - task.contract.leftYmm), Math.abs(rightY - task.contract.rightYmm));
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
  measurements.maxYErrorMm = maxYError;
  measurements.sliderPositions = sliderPositions;
  measurements.collision = { sampled: collisionSampled, separated: collisionSeparated, firstFailure };
  const positionOk = maxPositionError <= task.contract.sliderToleranceMm && maxYError <= task.contract.sliderToleranceMm;
  const collisionOk = collisionSampled > 0 && collisionSeparated === collisionSampled;
  const toolVersion = `twin-bench/1 openscad:${openscadVersion()}`;

  const distinctObservation: Observation = {
    id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256,
    method: "Canonical order-independent triangle hash per rendered instance mesh.", toolVersion,
    coverage: `${zeroParts.length} instance mesh(es): ${zeroParts.map((part) => part.partId).join(", ")}.`,
    ...(distinct === zeroParts.length ? {} : { reason: `Only ${distinct} distinct instance meshes across ${zeroParts.length} selectors.` }),
  };
  const phaseObservation: Observation = {
    id: "measured-joint-frames", status: "MEASURED", value: positionOk, artifactSha256,
    method: "Slider centre positions from rendered mesh bounds, compared with crank/rod closure at phases 0° and the declared right-cylinder phase.", toolVersion,
    coverage: `${task.angles.length} angle(s); left/right slider centres; tolerance ${task.contract.sliderToleranceMm} mm.`,
    ...(positionOk ? {} : { reason: `Slider position error ${maxPositionError.toFixed(4)} mm, Y-centre error ${maxYError.toFixed(4)} mm exceeds ${task.contract.sliderToleranceMm} mm.` }),
  };
  const collisionObservation: Observation = {
    id: "sampled-motion", status: "MEASURED", value: collisionOk, artifactSha256,
    method: "All 15 pairs of the six rendered instance meshes at each listed angle; exact triangle intersection against a BVH.", toolVersion,
    coverage: `${task.angles.length} angle(s), ${collisionSampled} pair checks.`,
    ...(collisionOk ? {} : { reason: firstFailure ?? "A collision pair was not sampled." }),
  };
  const sourceObservation: Observation = {
    id: "source-motion", status: "MEASURED", value: positionOk, artifactSha256,
    method: "Actual source re-render at every listed angle; both slider centres compared with the closure formula, so a static or same-phase source fails.", toolVersion,
    coverage: `${task.angles.length} angle(s), phase ${task.contract.phaseDeg}°.`,
    ...(positionOk ? {} : { reason: `Source-driven slider positions do not follow the declared 180° phase: max error ${maxPositionError.toFixed(4)} mm.` }),
  };
  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation,
    "measured-joint-frames": phaseObservation,
    "sampled-motion": collisionObservation,
    "source-motion": sourceObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") {
      const observed = observations[requirement.id]?.value;
      return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observed)}, expected ${String(requirement.expected.value)}.` };
    }
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
