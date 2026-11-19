/**
 * L4 declaration-bound family: a seven-part, nine-instance slider-crank with
 * two transverse keys and two quarter-turn guide retainers.
 *
 * The task owns the complete frozen assembly declaration. The submission owns
 * geometry only; if its embedded declaration differs from the frozen one, the
 * candidate is blocked rather than silently measured against a different
 * mechanism. Motion/collision are measured from nine re-rendered instance
 * meshes; the declared removal sequence is checked on seven part meshes, and a
 * frozen wrong order must be blocked by the guide retainers.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { canonicalJson } from "../../src/lib/canonical-json";
import path from "node:path";
import { validateAssemblySpec, type AssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { assemblySpecificationHash } from "../../src/lib/assembly/spec-hash";
import type { SliderCrankGeometryContract } from "../../src/lib/assembly/slider-crank-geometry";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { renderAssemblySpecParts, type RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
import { sampleSliderCrankSource } from "../../src/lib/tools/slider-crank-measurement";
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

export interface L4TaskFile {
  schemaVersion: 1;
  id: string;
  prompt: string;
  specFile: string;
  specSha256: string;
  motion: {
    angles: number[];
    contract: SliderCrankGeometryContract;
    selectors: { crank: string; rod: string; slider: string; frame: string };
    attachments: Record<string, string>;
    motionParameter: string;
    poseParameters: Record<string, number | string | boolean>;
  };
  wrongOrder: { operationId: string; beforeOperationId: string };
  requirements: BenchRequirement[];
  notes?: string[];
}

export interface L4BenchTask extends L4TaskFile {
  spec: AssemblySpec;
}

export interface L4CaseMeasurements {
  partMeshes: Array<{ partId: string; triangleCount: number; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
  instanceMeshes: Array<{ partId: string; triangleCount: number }>;
  angles: number[];
  landmarkStatus: string;
  collisionStatus: string;
  motionStatus: string;
  crankRadiusMm: number | null;
  crankResidualMm: number | null;
  rodLengthSpreadMm: number | null;
  axisDriftMm: number | null;
  disassembly: {
    correctStatus: string;
    wrongOrderStatus: string;
    correctOperations: number;
    wrongOrderOperations: number;
    wrongOrderFirstNonPass: string | null;
  } | null;
}

export interface L4CaseReport {
  schemaVersion: "l4-bench.case.v1";
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
  measurements: L4CaseMeasurements;
  provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string };
  unknowns: string[];
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(`${field} must be an identifier`);
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

function validateMotion(value: unknown): L4TaskFile["motion"] {
  if (!value || typeof value !== "object") fail("task.motion must be an object");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.angles) || raw.angles.length < 3 || raw.angles.length > 24) fail("task.motion.angles must have 3 to 24 entries");
  const angles = raw.angles.map((item) => finite(item, "task.motion.angles[]"));
  if (new Set(angles).size !== angles.length) fail("task.motion.angles must be distinct");
  if (!angles.includes(0)) fail("task.motion.angles must include 0");
  if (!raw.contract || typeof raw.contract !== "object") fail("task.motion.contract must be an object");
  const c = raw.contract as Record<string, unknown>;
  const contract: SliderCrankGeometryContract = {
    crankRadiusMm: finite(c.crankRadiusMm, "task.motion.contract.crankRadiusMm"),
    rodLengthMm: finite(c.rodLengthMm, "task.motion.contract.rodLengthMm"),
    toleranceMm: finite(c.toleranceMm, "task.motion.contract.toleranceMm"),
    sectionYmm: finite(c.sectionYmm, "task.motion.contract.sectionYmm"),
    pinRadiusMm: radiusWindow(c.pinRadiusMm, "task.motion.contract.pinRadiusMm"),
    rodBoreRadiusMm: radiusWindow(c.rodBoreRadiusMm, "task.motion.contract.rodBoreRadiusMm"),
    ...(c.axisProbeMm !== undefined ? { axisProbeMm: finite(c.axisProbeMm, "task.motion.contract.axisProbeMm") } : {}),
  };
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > 0) || !(contract.toleranceMm >= 1e-4)) fail("task.motion.contract has invalid dimensions");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("task.motion.selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const roles = ["crank", "rod", "slider", "frame"] as const;
  if (Object.keys(s).sort().join(",") !== [...roles].sort().join(",")) fail("task.motion.selectors must name exactly crank, rod, slider and frame");
  const selectors = Object.fromEntries(roles.map((role) => [role, id(s[role], `task.motion.selectors.${role}`)])) as L4TaskFile["motion"]["selectors"];
  if (new Set(Object.values(selectors)).size !== 4) fail("task.motion.selectors must be distinct");
  if (!raw.attachments || typeof raw.attachments !== "object" || Array.isArray(raw.attachments)) fail("task.motion.attachments must be an object");
  const attachments: Record<string, string> = {};
  for (const [key, selector] of Object.entries(raw.attachments as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) fail(`task.motion.attachments key "${key}" is invalid`);
    if ((roles as readonly string[]).includes(key)) fail(`task.motion.attachments key "${key}" collides with a role`);
    attachments[key] = id(selector, `task.motion.attachments.${key}`);
  }
  if (Object.keys(attachments).length > 8) fail("task.motion.attachments supports at most 8 parts");
  const all = [...Object.values(selectors), ...Object.values(attachments)];
  if (new Set(all).size !== all.length) fail("task.motion selectors must be distinct across roles and attachments");
  if (typeof raw.motionParameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.motionParameter)) fail("task.motion.motionParameter must be a SCAD identifier");
  if (["agentscad_part", "agentscad_pose"].includes(raw.motionParameter)) fail("task.motion.motionParameter must not be a reserved control");
  if (!raw.poseParameters || typeof raw.poseParameters !== "object" || Array.isArray(raw.poseParameters)) fail("task.motion.poseParameters must be an object");
  const poseParameters: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(raw.poseParameters as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || !["string", "number", "boolean"].includes(typeof value)) fail(`task.motion.poseParameters.${key} is invalid`);
    poseParameters[key] = value as number | string | boolean;
  }
  if (Object.hasOwn(poseParameters, raw.motionParameter)) fail("task.motion.poseParameters must not set the motion parameter");
  return { angles, contract, selectors, attachments, motionParameter: raw.motionParameter, poseParameters };
}

export function l4Directory(): string { return import.meta.dir; }
export function l4TasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function l4SubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }

export async function loadL4Tasks(root = l4TasksDirectory(), specsRoot = path.join(import.meta.dir, "specs")): Promise<L4BenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: L4BenchTask[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(root, name), "utf8")) as Record<string, unknown>;
    if (raw.schemaVersion !== 1) fail(`${name}: schemaVersion must be 1`);
    const taskId = id(raw.id, `${name}.id`);
    if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail(`${name}: prompt must be non-trivial`);
    if (typeof raw.specFile !== "string" || raw.specFile.includes("..") || path.isAbsolute(raw.specFile)) fail(`${name}: specFile must be a relative path without ..`);
    if (typeof raw.specSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.specSha256)) fail(`${name}: specSha256 must be a lowercase SHA-256`);
    const specPath = path.join(specsRoot, raw.specFile);
    const parsedSpec = validateAssemblySpec(JSON.parse(await readFile(specPath, "utf8")));
    if (!parsedSpec.success) fail(`${name}: byte spec is invalid`);
    const spec = parsedSpec.data;
    const actualSpecHash = assemblySpecificationHash(spec);
    if (actualSpecHash !== raw.specSha256) fail(`${name}: frozen specSha256 does not match ${actualSpecHash}`);
    const motion = validateMotion(raw.motion);
    if (!raw.wrongOrder || typeof raw.wrongOrder !== "object") fail(`${name}: wrongOrder must be an object`);
    const w = raw.wrongOrder as Record<string, unknown>;
    const operationId = id(w.operationId, `${name}.wrongOrder.operationId`);
    const beforeOperationId = id(w.beforeOperationId, `${name}.wrongOrder.beforeOperationId`);
    if (operationId === beforeOperationId) fail(`${name}: wrongOrder must move a different operation`);
    const operationIds = new Set(spec.operations.map((operation) => operation.id));
    if (!operationIds.has(operationId) || !operationIds.has(beforeOperationId)) fail(`${name}: wrongOrder names an unknown operation`);
    const declaredInstances = new Set(spec.instances.map((instance) => instance.id));
    for (const key of [...Object.values(motion.selectors), ...Object.keys(motion.attachments)]) {
      if (!declaredInstances.has(key)) fail(`${name}: selector ${key} is not a declared instance`);
    }
    if (spec.instances.length !== 4 + Object.keys(motion.attachments).length) fail(`${name}: selector/attachment count does not match the frozen spec's instances`);
    if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail(`${name}: requirements must be non-empty`);
    const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
      if (!entry || typeof entry !== "object") fail(`${name}: requirements[${index}] must be an object`);
      const requirement = entry as Record<string, unknown>;
      if (typeof requirement.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(requirement.id)) fail(`${name}: requirements[${index}].id is invalid`);
      if (!["parts", "assembly", "motion", "physical"].includes(String(requirement.layer))) fail(`${name}: requirements[${index}].layer is invalid`);
      if (typeof requirement.required !== "boolean" || typeof requirement.applicable !== "boolean") fail(`${name}: requirements[${index}] flags are invalid`);
      const expected = requirement.expected as Record<string, unknown> | undefined;
      if (!expected || typeof expected !== "object" || expected.kind !== "equals" || !["string", "boolean", "number"].includes(typeof expected.value)) fail(`${name}: requirements[${index}].expected must be an exact primitive`);
      if (typeof expected.value === "number" && !Number.isFinite(expected.value)) fail(`${name}: requirements[${index}].expected.value must be finite`);
      return { id: requirement.id, layer: requirement.layer as BenchRequirement["layer"], required: requirement.required, applicable: requirement.applicable, expected: { kind: "equals", value: expected.value as string | boolean | number } };
    });
    if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) fail(`${name}: duplicate requirement id`);
    const observable = new Set(["distinct-exported-parts", "measured-joint-frames", "sampled-motion", "source-motion", "disassembly-path"]);
    for (const requirement of requirements) if (!observable.has(requirement.id)) fail(`${name}: requirement ${requirement.id} has no observer`);
    const distinct = requirements.find((requirement) => requirement.id === "distinct-exported-parts");
    const expectedInstances = spec.instances.length;
    if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== expectedInstances) fail(`${name}: distinct-exported-parts must equal ${expectedInstances}`);
    tasks.push({
      schemaVersion: 1, id: taskId, prompt: raw.prompt, specFile: raw.specFile, specSha256: raw.specSha256,
      motion, wrongOrder: { operationId, beforeOperationId }, requirements, spec,
      ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}),
    });
  }
  if (tasks.length === 0) fail(`no L4 tasks found under ${root}`);
  return tasks;
}

export async function loadL4Submissions(taskId: string, root = l4SubmissionsDirectory()): Promise<Submission[]> {
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
/** Diagnostic only: the hash check remains the gate. Lists frozen top-level sections that differ. */
export function specSectionDiff(actual: AssemblySpec, expected: AssemblySpec): string[] {
  const sections = ["parts", "instances", "connections", "motions", "operations", "groundedInstanceId"] as const;
  return sections.filter((section) => canonicalJson(actual[section]) !== canonicalJson(expected[section]));
}

function observationStatus(status: string | undefined): Observation["status"] {
  return status === "PASS" || status === "FAIL" ? "MEASURED" : status === "ERROR" ? "ERROR" : "NOT_RUN";
}

function wrongOrderSpec(task: L4BenchTask): AssemblySpec {
  const spec = structuredClone(task.spec);
  const index = spec.operations.findIndex((operation) => operation.id === task.wrongOrder.operationId);
  if (index < 0) throw new Error("Wrong-order operation is missing");
  const [operation] = spec.operations.splice(index, 1);
  const before = spec.operations.findIndex((entry) => entry.id === task.wrongOrder.beforeOperationId);
  if (before < 0) throw new Error("Wrong-order target is missing");
  spec.operations.splice(before, 0, operation);
  return spec;
}

export async function scoreL4Submission(task: L4BenchTask, submission: Submission): Promise<L4CaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = {
    createdAt: new Date().toISOString(),
    backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
    openscad: openscadVersion(),
    runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
    platform: process.platform,
  };
  const unknowns = [
    "A PASS covers five listed input angles, seven part meshes and the declared discrete removal poses; it is not continuous motion, force, wear, tool access or physical function.",
    "The declaration is task-owned and frozen. A submission that changes any part, instance, joint, operation, range or fit is blocked before measurement rather than scored against a different mechanism.",
    "The wrong-order check is a frozen reorder; it demonstrates that this declared key/retainer order blocks that route, not that no other route exists.",
  ];
  const empty: L4CaseMeasurements = {
    partMeshes: [], instanceMeshes: [], angles: task.motion.angles, landmarkStatus: "NOT_RUN", collisionStatus: "NOT_RUN",
    motionStatus: "NOT_RUN", crankRadiusMm: null, crankResidualMm: null, rodLengthSpreadMm: null, axisDriftMm: null, disassembly: null,
  };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: L4CaseMeasurements): L4CaseReport => {
    const scored = scoreEvidence(results.map((result) => ({ id: result.id, status: result.status })));
    return {
      schemaVersion: "l4-bench.case.v1", taskId: task.id, submission: submission.id,
      expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256,
      status, gatePassed: status === "PASS", results,
      layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) },
      measurements, provenance, unknowns,
    };
  };
  const blocked = (reason: string): L4CaseReport => {
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id, layer: requirement.layer, required: requirement.required,
      status: requirement.applicable ? "ERROR" : "SKIP",
      reason,
      observation: { id: requirement.id, status: "ERROR", reason },
    }));
    return baseReport(aggregateStatus(results), results, empty);
  };

  const extracted = extractEmbeddedAssemblySpec(submission.source);
  if (extracted.status !== "valid") return blocked("The source carries no valid embedded assembly declaration.");
  if (assemblySpecificationHash(extracted.spec) !== task.specSha256) {
    const changed = specSectionDiff(extracted.spec, task.spec);
    return blocked(`The embedded declaration does not match the task's frozen specification (changed: ${changed.join(", ") || "unknown section"}); refusing to measure a different mechanism.`);
  }

  let partRender: Awaited<ReturnType<typeof renderAssemblySpecParts>>;
  try {
    partRender = await renderAssemblySpecParts(submission.source, task.spec);
  } catch (error) {
    return blocked(`The declared part meshes did not render: ${error instanceof Error ? error.message : String(error)}`);
  }
  const partMeshes = Object.fromEntries(partRender.parts.map((part) => [part.partId, part.stl]));
  const measurements: L4CaseMeasurements = {
    ...empty,
    partMeshes: partRender.parts.map((part) => ({ partId: part.partId, triangleCount: part.triangleCount, bounds: meshBounds(readBinaryStl(part.stl)) })),
  };
  let zeroParts: RenderedAssemblyPart[] | null = null;
  let sampled: Awaited<ReturnType<typeof sampleSliderCrankSource>>;
  try {
    sampled = await sampleSliderCrankSource({
      scadSource: submission.source, contract: task.motion.contract, angles: task.motion.angles,
      motionParameter: task.motion.motionParameter, selectors: task.motion.selectors,
      attachments: task.motion.attachments, poseParameters: task.motion.poseParameters,
      onArtifacts: async (angle, parts) => { if (angle === 0) zeroParts = parts; },
    });
  } catch (error) {
    return blocked(`The 9-instance motion sample could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
  const instances = zeroParts as RenderedAssemblyPart[] | null;
  if (instances) measurements.instanceMeshes = instances.map((part) => ({ partId: part.partId, triangleCount: part.triangleCount }));
  measurements.landmarkStatus = sampled.landmarkStatus;
  measurements.collisionStatus = sampled.collision.status;
  measurements.motionStatus = sampled.motion?.status ?? "NOT_RUN";
  measurements.crankRadiusMm = sampled.motion?.crank?.radiusMm ?? null;
  measurements.crankResidualMm = sampled.motion?.crank?.residualMm ?? null;
  measurements.rodLengthSpreadMm = sampled.motion?.rodLengthMm?.spread ?? null;
  measurements.axisDriftMm = sampled.motion?.axisDriftMm ?? null;

  let disassemblyCorrect: ReturnType<typeof checkDeclaredPoseDisassembly> | null = null;
  let disassemblyWrong: ReturnType<typeof checkDeclaredPoseDisassembly> | null = null;
  try {
    disassemblyCorrect = checkDeclaredPoseDisassembly({ spec: task.spec, meshes: partMeshes, offlineEvaluation: true, budgetMs: 120000 });
    disassemblyWrong = checkDeclaredPoseDisassembly({ spec: wrongOrderSpec(task), meshes: partMeshes, offlineEvaluation: true, budgetMs: 120000 });
    const wrongFirst = disassemblyWrong.results.find((result) => result.status !== "PASS");
    measurements.disassembly = {
      correctStatus: disassemblyCorrect.status, wrongOrderStatus: disassemblyWrong.status,
      correctOperations: disassemblyCorrect.results.length, wrongOrderOperations: disassemblyWrong.results.length,
      wrongOrderFirstNonPass: wrongFirst ? `${wrongFirst.instanceId}:${wrongFirst.status}` : null,
    };
  } catch (error) {
    return blocked(`Declared disassembly could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
  }

  const artifactSha256 = instances ? sha256(instances.map((part) => part.sha256).join(":")) : sourceSha256;
  const distinct = instances ? new Set(instances.map((part) => canonicalMeshHash(readBinaryStl(part.stl)))).size : 0;
  const toolVersion = `l4-bench/1 openscad:${openscadVersion()}`;
  const distinctObservation: Observation = instances
    ? { id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256,
        method: "Canonical order-independent triangle hash per rendered instance mesh.",
        toolVersion, coverage: `${instances.length} instance mesh(es): ${instances.map((part) => part.partId).join(", ")}.`,
        ...(distinct === instances.length ? {} : { reason: `Only ${distinct} distinct instance meshes across ${instances.length} selectors.` }) }
    : { id: "distinct-exported-parts", status: "NOT_RUN", reason: "No zero-pose instance meshes.", toolVersion };
  const firstNonPass = (items: Array<{ status: string; reason?: string }>) => items.find((item) => item.status !== "PASS");
  const landmarkObservation: Observation = {
    id: "measured-joint-frames", status: observationStatus(sampled.landmarkStatus), value: sampled.landmarkStatus === "PASS",
    artifactSha256, method: "Circular-section landmarks for crank/rod/slider at the listed angles; the guide prismatic axis is not separately identified.",
    toolVersion, coverage: sampled.coverage,
    ...(sampled.landmarkStatus === "PASS" ? {} : { reason: firstNonPass(sampled.samples)?.reason ?? "A landmark pose did not pass." }),
  };
  const collisionObservation: Observation = {
    id: "sampled-motion", status: observationStatus(sampled.collision.status), value: sampled.collision.status === "PASS",
    artifactSha256, method: "Nine re-rendered instance meshes at each listed angle; all 36 instance pairs checked by BVH.",
    toolVersion, coverage: `${sampled.collision.samples.length} angle(s): ${sampled.collision.samples.map((sample) => `${sample.angleDegrees}:${sample.status}`).join(", ")}.`,
    ...(sampled.collision.status === "PASS" ? {} : { reason: firstNonPass(sampled.collision.samples)?.reason ?? "A collision pose did not pass." }),
  };
  const motionStatus = sampled.motion?.status ?? "NOT_RUN";
  const motionObservation: Observation = {
    id: "source-motion", status: observationStatus(motionStatus), value: motionStatus === "PASS", artifactSha256,
    method: "Actual source re-render at every listed angle; crank circle fit, rod-length constancy and pin-axis parallelism.",
    toolVersion,
    coverage: sampled.motion ? `Cross-pose fit at ${sampled.motion.coverage.poses} pose(s).` : "No cross-pose motion evidence.",
    ...(motionStatus === "PASS" ? {} : { reason: (sampled.motion?.failures ?? [sampled.motion?.reason ?? "Cross-pose motion did not run."]).join(" ") }),
  };
  const correctPass = disassemblyCorrect.status === "PASS";
  const wrongBlocked = disassemblyWrong.status === "FAIL";
  const disassemblyStatus: Observation["status"] = disassemblyCorrect.status === "ERROR" || disassemblyWrong.status === "ERROR"
    ? "ERROR"
    : disassemblyCorrect.status === "NOT_RUN" || disassemblyWrong.status === "NOT_RUN" ? "NOT_RUN" : "MEASURED";
  const disassemblyObservation: Observation = {
    id: "disassembly-path", status: disassemblyStatus, value: correctPass && wrongBlocked, artifactSha256,
    method: "Frozen correct declaration removal and a frozen reordered wrong sequence on the seven part meshes; the guide retainers must block the wrong order.",
    toolVersion,
    coverage: `Correct: ${disassemblyCorrect.results.length} operation(s); wrong order: ${disassemblyWrong.results.length} operation(s); part meshes: ${partRender.parts.map((part) => part.partId).join(", ")}.`,
    ...(correctPass && wrongBlocked ? {} : { reason: !correctPass
      ? `Correct removal did not pass: ${disassemblyCorrect.reason}`
      : !wrongBlocked ? `Wrong removal order was not blocked (${disassemblyWrong.status}): ${disassemblyWrong.reason}` : "Disassembly evidence is incomplete." }),
  };

  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation, "measured-joint-frames": landmarkObservation,
    "sampled-motion": collisionObservation, "source-motion": motionObservation, "disassembly-path": disassemblyObservation,
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
