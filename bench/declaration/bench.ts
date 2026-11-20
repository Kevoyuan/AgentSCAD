/**
 * L4.1 contract-bound declaration family.
 *
 * The submission must embed a declaration that satisfies a role/selector
 * contract: six parts, one instance each, six joint records, 0-360 motion and
 * a fixed removal order. IDs, instance names and part/connection order may
 * change; the contract does not require a byte-identical spec. Geometry is
 * still measured from the rendered source, and a submitted declaration that
 * fails the contract is blocked before rendering.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateAssemblySpec, type AssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { checkDeclaredPoseDisassembly } from "../../src/lib/assembly/declared-pose-disassembly";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { meshesIntersect } from "../../src/lib/geometry/mesh-collision";
import { renderAssemblyParts, type RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
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
import { validateSliderTask, type SliderBenchTask, type SliderSelectors } from "../slider/bench";

export interface DeclarationPart { role: string; selector: string; instances: number }
export interface DeclarationConnection { type: string; a: string; b: string }
export interface DeclarationContract {
  parts: DeclarationPart[];
  groundedSelector: string;
  connections: DeclarationConnection[];
  motionRange: { min: number; max: number };
  operations: string[];
  wrongOrder: string[];
}
export interface DeclarationTaskFile {
  schemaVersion: 1;
  id: string;
  prompt: string;
  geometry: {
    selectors: SliderSelectors;
    attachments: Record<string, string>;
    motionParameter: string;
    poseParameters: Record<string, number | string | boolean>;
    angles: number[];
    contract: SliderBenchTask["contract"];
  };
  declaration: DeclarationContract;
  requirements: BenchRequirement[];
  notes?: string[];
}
export interface DeclarationBenchTask extends DeclarationTaskFile {
  geometryTask: SliderBenchTask;
  contract: DeclarationContract;
}

export interface DeclarationCaseMeasurements {
  parts: Array<{ id: string; selector: string; triangleCount: number }>;
  angles: number[];
  declarationFindings: string[];
  disassembly: { correctStatus: string; wrongOrderStatus: string; correctOperations: number; wrongOrderOperations: number; wrongFirstNonPass: string | null } | null;
  maxPositionErrorMm: number | null;
  collision: { sampled: number; separated: number; firstFailure: string | null };
}

export interface DeclarationCaseReport {
  schemaVersion: "declaration-bench.case.v1";
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
  measurements: DeclarationCaseMeasurements;
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

export function validateDeclarationContract(value: unknown): DeclarationContract {
  if (!value || typeof value !== "object") fail("task.declaration must be an object");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) fail("task.declaration.parts must be non-empty");
  const parts: DeclarationPart[] = raw.parts.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.declaration.parts[${index}] must be an object`);
    const part = entry as Record<string, unknown>;
    return { role: identifier(part.role, `declaration.parts[${index}].role`), selector: identifier(part.selector, `declaration.parts[${index}].selector`), instances: finite(part.instances, `declaration.parts[${index}].instances`) };
  });
  for (const part of parts) if (!Number.isInteger(part.instances) || part.instances < 1) fail(`declaration part ${part.role} instances must be a positive integer`);
  if (new Set(parts.map((part) => part.role)).size !== parts.length) fail("declaration part roles must be unique");
  if (new Set(parts.map((part) => part.selector)).size !== parts.length) fail("declaration part selectors must be unique");
  const groundedSelector = identifier(raw.groundedSelector, "declaration.groundedSelector");
  if (!parts.some((part) => part.selector === groundedSelector)) fail("declaration.groundedSelector must name a declared part selector");
  if (!Array.isArray(raw.connections) || raw.connections.length === 0) fail("task.declaration.connections must be non-empty");
  const connections: DeclarationConnection[] = raw.connections.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.declaration.connections[${index}] must be an object`);
    const connection = entry as Record<string, unknown>;
    return { type: identifier(connection.type, `declaration.connections[${index}].type`), a: identifier(connection.a, `declaration.connections[${index}].a`), b: identifier(connection.b, `declaration.connections[${index}].b`) };
  });
  for (const connection of connections) {
    if (!parts.some((part) => part.selector === connection.a) || !parts.some((part) => part.selector === connection.b)) fail("declaration connection endpoints must name declared part selectors");
  }
  if (!raw.motionRange || typeof raw.motionRange !== "object") fail("task.declaration.motionRange must be an object");
  const m = raw.motionRange as Record<string, unknown>;
  const motionRange = { min: finite(m.min, "declaration.motionRange.min"), max: finite(m.max, "declaration.motionRange.max") };
  if (!(motionRange.min < motionRange.max)) fail("declaration.motionRange must have min < max");
  const selectors = parts.map((part) => part.selector);
  if (!Array.isArray(raw.operations) || raw.operations.length !== parts.reduce((sum, part) => sum + part.instances, 0) - 1) fail("declaration.operations must remove every non-grounded instance once");
  const operations = raw.operations.map((entry, index) => { const selector = identifier(entry, `declaration.operations[${index}]`); if (!selectors.includes(selector)) fail(`declaration operation ${selector} is not a declared part selector`); return selector; });
  if (new Set(operations).size !== operations.length) fail("declaration operations must not repeat a part selector");
  if (operations.includes(groundedSelector)) fail("declaration operations must not remove the grounded part");
  if (!Array.isArray(raw.wrongOrder) || raw.wrongOrder.length !== operations.length) fail("declaration.wrongOrder must have the same length as operations");
  const wrongOrder = raw.wrongOrder.map((entry, index) => { const selector = identifier(entry, `declaration.wrongOrder[${index}]`); if (!operations.includes(selector)) fail("declaration.wrongOrder must be a permutation of operations"); return selector; });
  if ([...wrongOrder].sort().join(",") !== [...operations].sort().join(",")) fail("declaration.wrongOrder must be a permutation of operations");
  if (wrongOrder.join(",") === operations.join(",")) fail("declaration.wrongOrder must differ from operations");
  return { parts, groundedSelector, connections, motionRange, operations, wrongOrder };
}

export function checkDeclarationContract(spec: AssemblySpec, contract: DeclarationContract): { status: "PASS" | "FAIL"; findings: string[] } {
  const findings: string[] = [];
  const partsBySelector = new Map<string, AssemblySpec["parts"][number]>();
  for (const part of spec.parts) partsBySelector.set(part.selector, part);
  const instancesByPart = new Map<string, AssemblySpec["instances"]>();
  for (const instance of spec.instances) {
    const list = instancesByPart.get(instance.partId) ?? [];
    list.push(instance);
    instancesByPart.set(instance.partId, list);
  }
  let expectedInstances = 0;
  for (const required of contract.parts) {
    const part = partsBySelector.get(required.selector);
    if (!part) { findings.push(`missing part selector ${required.selector}`); continue; }
    const instances = instancesByPart.get(part.id) ?? [];
    expectedInstances += required.instances;
    if (instances.length !== required.instances) findings.push(`part ${required.selector} has ${instances.length} instance(s), expected ${required.instances}`);
  }
  if (spec.instances.length !== expectedInstances) findings.push(`declaration has ${spec.instances.length} instance(s), expected ${expectedInstances}`);
  const grounded = spec.instances.find((instance) => instance.id === spec.groundedInstanceId);
  if (!grounded) findings.push("no grounded instance");
  else {
    const groundedPart = spec.parts.find((part) => part.id === grounded.partId);
    if (!groundedPart || groundedPart.selector !== contract.groundedSelector) findings.push(`grounded instance is not selector ${contract.groundedSelector}`);
  }
  const selectorForInstance = (instanceId: string): string | null => {
    const instance = spec.instances.find((entry) => entry.id === instanceId);
    if (!instance) return null;
    return spec.parts.find((part) => part.id === instance.partId)?.selector ?? null;
  };
  for (const required of contract.connections) {
    const found = spec.connections.some((connection) => {
      if (connection.type !== required.type) return false;
      const a = selectorForInstance(connection.a);
      const b = selectorForInstance(connection.b);
      return (a === required.a && b === required.b) || (a === required.b && b === required.a);
    });
    if (!found) findings.push(`missing ${required.type} connection ${required.a}-${required.b}`);
  }
  const hasMotionRange = spec.motions.some((motion) => motion.range.min <= contract.motionRange.min && motion.range.max >= contract.motionRange.max);
  if (!hasMotionRange) findings.push(`no motion range covering ${contract.motionRange.min}..${contract.motionRange.max}`);
  const operations = spec.operations.filter((operation) => operation.action === "disassemble");
  const operationSelectors = operations.map((operation) => selectorForInstance(operation.instanceId));
  if (operationSelectors.some((selector) => !selector)) findings.push("a disassembly operation names an unknown instance");
  const nonGrounded = spec.instances.filter((instance) => instance.id !== spec.groundedInstanceId);
  const operationInstances = operations.map((operation) => operation.instanceId);
  if (nonGrounded.some((instance) => !operationInstances.includes(instance.id))) findings.push("a non-grounded instance has no disassembly operation");
  if (new Set(operationInstances).size !== operationInstances.length) findings.push("a disassembly operation repeats an instance");
  if (operationSelectors.join(",") !== contract.operations.join(",")) findings.push(`disassembly order is [${operationSelectors.join(", ")}], expected [${contract.operations.join(", ")}]`);
  return { status: findings.length === 0 ? "PASS" : "FAIL", findings };
}

export function declarationTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function declarationSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadDeclarationTasks(root = declarationTasksDirectory()): Promise<DeclarationBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: DeclarationBenchTask[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(root, name), "utf8")) as DeclarationTaskFile;
    if (raw.schemaVersion !== 1) fail(`${name}: schemaVersion must be 1`);
    if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail(`${name}: id is invalid`);
    if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail(`${name}: prompt must be non-trivial`);
    if (!raw.geometry || typeof raw.geometry !== "object") fail(`${name}: geometry must be an object`);
    if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail(`${name}: requirements must be non-empty`);
    const geometryTask = validateSliderTask({
      schemaVersion: 1, id: "geometry", prompt: raw.prompt,
      selectors: raw.geometry.selectors, attachments: raw.geometry.attachments,
      motionParameter: raw.geometry.motionParameter, poseParameters: raw.geometry.poseParameters,
      angles: raw.geometry.angles, contract: raw.geometry.contract, requirements: raw.requirements.filter((requirement) => requirement.id !== "disassembly-path"),
    });
    const contract = validateDeclarationContract(raw.declaration);
    const distinct = raw.requirements.find((requirement) => requirement.id === "distinct-exported-parts");
    if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 6) fail(`${name}: distinct-exported-parts must equal 6`);
    tasks.push({ ...raw, geometryTask, contract });
  }
  if (tasks.length === 0) fail(`no declaration tasks found under ${root}`);
  return tasks;
}
export async function loadDeclarationSubmissions(taskId: string, root = declarationSubmissionsDirectory()): Promise<Submission[]> {
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
function observationStatus(status: string | undefined): Observation["status"] {
  return status === "PASS" || status === "FAIL" ? "MEASURED" : status === "ERROR" ? "ERROR" : "NOT_RUN";
}

export async function scoreDeclarationSubmission(task: DeclarationBenchTask, submission: Submission): Promise<DeclarationCaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = [
    "A PASS covers nine listed angles and zero-pose removal plans; it is not continuous motion, force, wear, tool access or physical function.",
    "The declaration contract is structural: part/instance IDs and order may vary, but the six role selectors, joint endpoints, motion range and operation order are frozen. This is not autonomous declaration authorship.",
    "The rendered six-part geometry is measured from the source, not from declaration coordinates alone.",
  ];
  const empty: DeclarationCaseMeasurements = { parts: [], angles: task.geometryTask.angles, declarationFindings: [], disassembly: null, maxPositionErrorMm: null, collision: { sampled: 0, separated: 0, firstFailure: null } };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: DeclarationCaseMeasurements): DeclarationCaseReport => {
    const scored = scoreEvidence(results.map((result) => ({ id: result.id, status: result.status })));
    return { schemaVersion: "declaration-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string, findings: string[] = []): DeclarationCaseReport => {
    const results: Result[] = task.requirements.map((requirement) => ({ id: requirement.id, layer: requirement.layer, required: requirement.required, status: requirement.applicable ? "ERROR" : "SKIP", reason, observation: { id: requirement.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, { ...empty, declarationFindings: findings });
  };
  const extracted = extractEmbeddedAssemblySpec(submission.source);
  if (extracted.status !== "valid") return blocked("The source carries no valid embedded assembly declaration.");
  const parsed = validateAssemblySpec(extracted.spec);
  if (!parsed.success) return blocked("The embedded declaration is not a valid assembly specification.");
  const contract = checkDeclarationContract(parsed.data, task.contract);
  if (contract.status !== "PASS") return blocked(`The embedded declaration does not satisfy the task contract: ${contract.findings.join("; ")}`, contract.findings);
  const spec = parsed.data;
  let partRender: RenderedAssemblyPart[];
  try {
    partRender = await renderAssemblyParts({ scadSource: submission.source, parts: spec.parts.map((part) => ({ partId: part.id, selector: part.selector })) });
  } catch (error) { return blocked(`The declared part meshes did not render: ${error instanceof Error ? error.message : String(error)}`); }
  const partMeshes = Object.fromEntries(partRender.map((part) => [part.partId, part.stl]));
  const measurements: DeclarationCaseMeasurements = { ...empty, parts: partRender.map((part) => ({ id: part.partId, selector: spec.parts.find((entry) => entry.id === part.partId)?.selector ?? "?", triangleCount: part.triangleCount })), declarationFindings: contract.findings };
  let zeroParts: RenderedAssemblyPart[] | null = null;
  let sampled: Awaited<ReturnType<typeof sampleSliderCrankSource>>;
  try {
    sampled = await sampleSliderCrankSource({
      scadSource: submission.source, contract: task.geometryTask.contract, angles: task.geometryTask.angles,
      motionParameter: task.geometryTask.motionParameter, selectors: task.geometryTask.selectors,
      attachments: task.geometryTask.attachments, poseParameters: task.geometryTask.poseParameters,
      onArtifacts: async (angle, parts) => { if (angle === 0) zeroParts = parts; },
    });
  } catch (error) { return blocked(`The six-part motion sample did not run: ${error instanceof Error ? error.message : String(error)}`); }
  const instances = zeroParts as RenderedAssemblyPart[] | null;
  const artifactSha256 = instances ? sha256(instances.map((part) => part.sha256).join(":")) : sourceSha256;
  const distinct = instances ? new Set(instances.map((part) => canonicalMeshHash(readBinaryStl(part.stl)))).size : 0;
  measurements.maxPositionErrorMm = sampled.motion?.crank?.residualMm ?? null;
  measurements.collision = { sampled: sampled.collision.samples.reduce((sum, sample) => sum + (sample.pairs?.length ?? 0), 0), separated: sampled.collision.samples.filter((sample) => sample.status === "PASS").length, firstFailure: sampled.collision.samples.find((sample) => sample.status !== "PASS")?.reason ?? null };
  const correct = (() => { try { return checkDeclaredPoseDisassembly({ spec, meshes: partMeshes, offlineEvaluation: true, budgetMs: 120000 }); } catch (error) { return null; } })();
  const wrongSpec = structuredClone(spec);
  const operationBySelector = new Map<string, (typeof spec.operations)[number]>();
  for (const operation of spec.operations.filter((entry) => entry.action === "disassemble")) {
    const instance = spec.instances.find((entry) => entry.id === operation.instanceId);
    const part = instance ? spec.parts.find((entry) => entry.id === instance.partId) : null;
    if (part) operationBySelector.set(part.selector, operation);
  }
  wrongSpec.operations = task.contract.wrongOrder.map((selector) => operationBySelector.get(selector)).filter((operation): operation is (typeof spec.operations)[number] => Boolean(operation));
  const wrong = (() => { try { return checkDeclaredPoseDisassembly({ spec: wrongSpec, meshes: partMeshes, offlineEvaluation: true, budgetMs: 120000 }); } catch { return null; } })();
  if (!correct || !wrong) return blocked("Declared disassembly could not be evaluated.");
  const wrongFirst = wrong.results.find((result) => result.status !== "PASS");
  measurements.disassembly = { correctStatus: correct.status, wrongOrderStatus: wrong.status, correctOperations: correct.results.length, wrongOrderOperations: wrong.results.length, wrongFirstNonPass: wrongFirst ? `${wrongFirst.instanceId}:${wrongFirst.status}` : null };
  const toolVersion = `declaration-bench/1 openscad:${openscadVersion()}`;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: instances ? "MEASURED" : "NOT_RUN", value: distinct, artifactSha256, method: "Canonical order-independent triangle hash per rendered instance mesh.", toolVersion, coverage: instances ? `${instances.length} instance mesh(es).` : "no instances", ...(instances && distinct === instances.length ? {} : { reason: `Only ${distinct} distinct instance meshes.` }) };
  const landmarkObservation: Observation = { id: "measured-joint-frames", status: observationStatus(sampled.landmarkStatus), value: sampled.landmarkStatus === "PASS", artifactSha256, method: "Circular-section landmarks for crank/rod/slider at the listed angles.", toolVersion, coverage: sampled.coverage, ...(sampled.landmarkStatus === "PASS" ? {} : { reason: sampled.samples.find((sample) => sample.status !== "PASS")?.reason ?? "A landmark pose did not pass." }) };
  const collisionObservation: Observation = { id: "sampled-motion", status: observationStatus(sampled.collision.status), value: sampled.collision.status === "PASS", artifactSha256, method: "Six re-rendered instance meshes; all 15 pairs at each listed angle.", toolVersion, coverage: `${sampled.collision.samples.length} angle(s).`, ...(sampled.collision.status === "PASS" ? {} : { reason: sampled.collision.samples.find((sample) => sample.status !== "PASS")?.reason ?? "A collision pose did not pass." }) };
  const motionStatus = sampled.motion?.status ?? "NOT_RUN";
  const sourceObservation: Observation = { id: "source-motion", status: observationStatus(motionStatus), value: motionStatus === "PASS", artifactSha256, method: "Actual source re-render at every listed angle; crank circle, rod length and pin-axis drift.", toolVersion, coverage: sampled.motion ? `${sampled.motion.coverage.poses} pose(s).` : "no motion", ...(motionStatus === "PASS" ? {} : { reason: (sampled.motion?.failures ?? [sampled.motion?.reason ?? "Cross-pose motion did not run."]).join(" ") }) };
  const correctPass = correct.status === "PASS";
  const wrongBlocked = wrong.status === "FAIL";
  const disassemblyStatus: Observation["status"] = correct.status === "ERROR" || wrong.status === "ERROR" ? "ERROR" : correct.status === "NOT_RUN" || wrong.status === "NOT_RUN" ? "NOT_RUN" : "MEASURED";
  const disassemblyObservation: Observation = { id: "disassembly-path", status: disassemblyStatus, value: correctPass && wrongBlocked, artifactSha256, method: "Contract-valid declaration's correct removal and a contract-frozen wrong order on the rendered part meshes.", toolVersion, coverage: `Correct ${correct.results.length} operation(s); wrong ${wrong.results.length}.`, ...(correctPass && wrongBlocked ? {} : { reason: !correctPass ? `Correct removal did not pass: ${correct.reason}` : !wrongBlocked ? `Wrong order was not blocked (${wrong.status}): ${wrong.reason}` : "Disassembly evidence incomplete." }) };
  const observations: Record<string, Observation> = { "distinct-exported-parts": distinctObservation, "measured-joint-frames": landmarkObservation, "sampled-motion": collisionObservation, "source-motion": sourceObservation, "disassembly-path": disassemblyObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
