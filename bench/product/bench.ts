/**
 * Product-path bench: calls the real prepareContractAssembly on a bundled
 * six-part declaration. It scores only layers the product can measure without
 * a confirmed requirement contract: distinct selectors, part connectivity,
 * export reconstruction and declared disassembly.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import { prepareContractAssembly } from "../../src/lib/assembly/prepare-contract-assembly";
import { deriveRequirementContract } from "../../src/lib/requirements/extract-requirements";
import { automaticSliderCrankKinematics } from "../../src/lib/assembly/automatic-slider-crank";
import { buildSliderCrankSourcePoseProtocolFromSpec } from "../../src/lib/tools/slider-crank-source-pose";
import { verifySourcePoses } from "../../src/lib/tools/source-pose-verification";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { meshesIntersect } from "../../src/lib/geometry/mesh-collision";
import { applyMatrixPoint as applyMatrix, toolCylinderMesh as toolMeshAt } from "../geometry";
import { validateAssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface ProductTask { schemaVersion: 1; id: string; prompt: string; request?: string; partCount: number; fit?: { minClearanceMm: number; maxClearanceMm: number; requirements: Array<{ connectionId: string; boreSelector: string }> }; sourcePoses?: { count: number; anglesDeg?: number[]; budgetMs?: number }; toolAccess?: { toolRadiusMm: number; fromMm: number; contactMm: number; contactToleranceMm?: number; samples?: number; approaches: Array<{ id: string; instanceId: string; direction: [number, number, number] }> }; requirements: BenchRequirement[]; notes?: string[] }
export interface ProductMeasurements {
  parts: number;
  partStatuses: string[];
  topology: string | null;
  reconstruction: string | null;
  disassembly: string | null;
  assembly: string | null;
  fitStatuses: Array<{ connectionId: string; status: string | null; joint: string | null; reason: string | null }>;
  reconstructionReason: string | null;
  disassemblyReason: string | null;
  assemblyReason: string | null;
  motion: string | null;
  motionReason: string | null;
  sourceMotion: string | null;
  sourceMotionReason: string | null;
  sourceMotionNine: string | null;
  sourceMotionNineReason: string | null;
  sourceMotionNineAnglesDeg: number[] | null;
  toolAccess: {
    status: string; reason: string; sampled: number;
    approaches: Array<{ id: string; instanceId: string; status: string; gapMm: number | null; sampled: number; firstFailure: string | null }>;
  } | null;
}
export interface ProductReport {
  schemaVersion: "product-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: ProductMeasurements; provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
export function validateProductTask(value: unknown): ProductTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (raw.request !== undefined && (typeof raw.request !== "string" || raw.request.trim().length < 8)) fail("request must be non-trivial when present");
  const partCount = finite(raw.partCount, "partCount");
  if (!Number.isInteger(partCount) || partCount < 1) fail("partCount must be a positive integer");
  let sourcePoses: { count: number; budgetMs?: number } | undefined;
  if (raw.sourcePoses !== undefined) {
    if (!raw.sourcePoses || typeof raw.sourcePoses !== "object") fail("sourcePoses must be an object");
    const sp = raw.sourcePoses as Record<string, unknown>;
    const count = finite(sp.count, "sourcePoses.count");
    if (!Number.isInteger(count) || count < 6 || count > 12) fail("sourcePoses.count must be an integer from 6 to 12");
    let anglesDeg: number[] | undefined;
    if (sp.anglesDeg !== undefined) {
      if (!Array.isArray(sp.anglesDeg) || sp.anglesDeg.length !== count) fail("sourcePoses.anglesDeg must list one angle per pose");
      anglesDeg = sp.anglesDeg.map((entry, index) => finite(entry, `sourcePoses.anglesDeg[${index}]`));
      if (new Set(anglesDeg).size !== anglesDeg.length) fail("sourcePoses.anglesDeg must be distinct");
    }
    let budgetMs: number | undefined;
    if (sp.budgetMs !== undefined) {
      budgetMs = finite(sp.budgetMs, "sourcePoses.budgetMs");
      if (budgetMs < 30000 || budgetMs > 300000) fail("sourcePoses.budgetMs must be 30000 to 300000");
    }
    sourcePoses = { count, ...(anglesDeg ? { anglesDeg } : {}), ...(budgetMs !== undefined ? { budgetMs } : {}) };
  }
  let toolAccess: ProductTask["toolAccess"];
  if (raw.toolAccess !== undefined) {
    if (!raw.toolAccess || typeof raw.toolAccess !== "object") fail("toolAccess must be an object");
    const t = raw.toolAccess as Record<string, unknown>;
    const toolRadiusMm = finite(t.toolRadiusMm, "toolAccess.toolRadiusMm");
    const fromMm = finite(t.fromMm, "toolAccess.fromMm");
    const contactMm = finite(t.contactMm, "toolAccess.contactMm");
    let contactToleranceMm: number | undefined;
    if (t.contactToleranceMm !== undefined) { contactToleranceMm = finite(t.contactToleranceMm, "toolAccess.contactToleranceMm"); if (contactToleranceMm < 0 || contactToleranceMm > 5) fail("toolAccess.contactToleranceMm is out of range"); }
    let samples: number | undefined;
    if (t.samples !== undefined) { samples = finite(t.samples, "toolAccess.samples"); if (!Number.isInteger(samples) || samples < 4 || samples > 64) fail("toolAccess.samples must be 4 to 64"); }
    if (!(toolRadiusMm > 0) || !(fromMm > contactMm) || !(contactMm >= 0)) fail("toolAccess bounds are invalid");
    if (!Array.isArray(t.approaches) || t.approaches.length === 0) fail("toolAccess.approaches must be non-empty");
    const approaches = t.approaches.map((entry, index) => {
      if (!entry || typeof entry !== "object") fail(`toolAccess.approaches[${index}] must be an object`);
      const a = entry as Record<string, unknown>;
      if (typeof a.id !== "string" || typeof a.instanceId !== "string") fail(`toolAccess.approaches[${index}] needs id and instanceId`);
      if (!Array.isArray(a.direction) || a.direction.length !== 3) fail(`toolAccess.approaches[${index}].direction must have 3 entries`);
      const direction = a.direction.map((value) => finite(value, `toolAccess.approaches[${index}].direction[]`)) as [number, number, number];
      const length = Math.hypot(...direction);
      if (!(length > 0)) fail(`toolAccess.approaches[${index}].direction must be non-zero`);
      return { id: a.id, instanceId: a.instanceId, direction: [direction[0] / length, direction[1] / length, direction[2] / length] as [number, number, number] };
    });
    toolAccess = { toolRadiusMm, fromMm, contactMm, ...(contactToleranceMm !== undefined ? { contactToleranceMm } : {}), ...(samples !== undefined ? { samples } : {}), approaches };
  }
  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("requirements must be non-empty");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`requirements[${index}] must be an object`);
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(r.id)) fail(`requirements[${index}].id is invalid`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(r.layer)) || typeof r.required !== "boolean" || typeof r.applicable !== "boolean") fail(`requirements[${index}] flags are invalid`);
    const e = r.expected as Record<string, unknown> | undefined;
    if (!e || e.kind !== "equals" || !["string", "boolean", "number"].includes(typeof e.value)) fail(`requirements[${index}].expected is invalid`);
    return { id: r.id, layer: r.layer as BenchRequirement["layer"], required: r.required, applicable: r.applicable, expected: { kind: "equals", value: e.value as string | boolean | number } };
  });
  const observable = new Set(["distinct-exported-parts", "part-connectivity", "assembly-reconstruction", "assembly-path", "disassembly-path", "diametral-clearance", "measured-joint-frames", "rigid-motion", "source-motion", "source-motion-nine", "tool-access"]);
  for (const r of requirements) if (!observable.has(r.id)) fail(`requirement ${r.id} has no product observer`);
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== partCount) fail("distinct-exported-parts must equal partCount");
  let fit: ProductTask["fit"];
  if (raw.fit !== undefined) {
    if (!raw.fit || typeof raw.fit !== "object") fail("fit must be an object");
    const f = raw.fit as Record<string, unknown>;
    const minClearanceMm = finite(f.minClearanceMm, "fit.minClearanceMm");
    const maxClearanceMm = finite(f.maxClearanceMm, "fit.maxClearanceMm");
    if (!(minClearanceMm >= 0) || !(maxClearanceMm >= minClearanceMm)) fail("fit clearance band is invalid");
    if (!Array.isArray(f.requirements) || f.requirements.length === 0) fail("fit.requirements must be non-empty");
    const requirements = f.requirements.map((entry, index) => {
      if (!entry || typeof entry !== "object") fail(`fit.requirements[${index}] must be an object`);
      const r = entry as Record<string, unknown>;
      if (typeof r.connectionId !== "string" || typeof r.boreSelector !== "string") fail(`fit.requirements[${index}] must have connectionId and boreSelector`);
      return { connectionId: r.connectionId, boreSelector: r.boreSelector };
    });
    fit = { minClearanceMm, maxClearanceMm, requirements };
  }
  if (requirements.some((r) => r.id === "source-motion-nine") && !sourcePoses) fail("a source-motion-nine requirement needs a sourcePoses contract");
  if (requirements.some((r) => r.id === "tool-access") && !toolAccess) fail("a tool-access requirement needs a toolAccess contract");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, ...(typeof raw.request === "string" ? { request: raw.request } : {}), partCount, ...(fit ? { fit } : {}), ...(sourcePoses ? { sourcePoses } : {}), ...(toolAccess ? { toolAccess } : {}), requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function productTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function productSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadProductTasks(root = productTasksDirectory()): Promise<ProductTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort(); const tasks: ProductTask[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validateProductTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no product tasks under ${root}`);
  return tasks;
}
export async function loadProductSubmissions(taskId: string, root = productSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
function statusOf(value: unknown): string | null { if (typeof value === "string") return value; if (value && typeof value === "object") { const s = (value as { status?: unknown }).status; return typeof s === "string" ? s : null; } return null; }

export const PRODUCT_BENCH_TRIAL_GATE_REASON = "Bench trial attribution: the derived contract is used for measurement attribution only; this is not user confirmation, acceptance, or a product requirement contract.";

/**
 * Sampled tool-reachability: a cylindrical tool sweeps from outside toward a
 * declared instance along a declared direction. Every sampled tool position must
 * be separated from every other instance, the final tip must sit within the
 * declared contact tolerance of the target, and the tool must not intersect the
 * target. This is sampled reachability, not a continuous path or a force model.
 */
async function measureToolAccess(task: ProductTask, submission: Submission, spec: Awaited<ReturnType<typeof extractEmbeddedAssemblySpec>> extends never ? never : any): Promise<ProductMeasurements["toolAccess"]> {
  if (!task.toolAccess) return null;
  const instanceById = new Map<string, { id: string; transform: number[]; selector: string }>();
  for (const instance of spec.instances) {
    const part = spec.parts.find((entry: { id: string; selector: string }) => entry.id === instance.partId);
    if (!part) continue;
    instanceById.set(instance.id, { id: instance.id, transform: instance.transform, selector: part.selector });
  }
  let rendered: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try {
    rendered = await renderAssemblyParts({
      scadSource: submission.source,
      parameters: { agentscad_pose: false, motion_angle: 0 },
      parts: [...instanceById.values()].map((instance) => ({ partId: instance.id, selector: instance.selector })),
    });
  } catch (error) {
    return { status: "ERROR", reason: error instanceof Error ? error.message : "Tool-access parts did not render.", sampled: 0, approaches: [] };
  }
  const meshes = new Map<string, TriangleMesh>();
  for (const instance of instanceById.values()) {
    const part = rendered.find((entry) => entry.partId === instance.id);
    if (part) meshes.set(instance.id, readBinaryStl(part.stl));
  }
  const approaches: NonNullable<ProductMeasurements["toolAccess"]>["approaches"] = [];
  let sampled = 0, anyFailure = false;
  for (const approach of task.toolAccess.approaches) {
    const target = instanceById.get(approach.instanceId);
    const targetMesh = target ? meshes.get(target.id) : undefined;
    if (!target || !targetMesh) { anyFailure = true; approaches.push({ id: approach.id, instanceId: approach.instanceId, status: "NOT_RUN", gapMm: null, sampled: 0, firstFailure: `Instance ${approach.instanceId} is not rendered.` }); continue; }
    const bounds = meshBounds(targetMesh);
    let minProjection = Infinity, maxProjection = -Infinity;
    const center: [number, number, number] = [0, 0, 0];
    const vertexCount = targetMesh.triangleCount * 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const base = vertex * 3;
      const world = applyMatrix(target.transform, [targetMesh.coordinates[base], targetMesh.coordinates[base + 1], targetMesh.coordinates[base + 2]]);
      const projection = world[0] * approach.direction[0] + world[1] * approach.direction[1] + world[2] * approach.direction[2];
      if (projection < minProjection) minProjection = projection;
      if (projection > maxProjection) maxProjection = projection;
      center[0] += world[0] / vertexCount; center[1] += world[1] / vertexCount; center[2] += world[2] / vertexCount;
    }
    const centerProjection = center[0] * approach.direction[0] + center[1] * approach.direction[1] + center[2] * approach.direction[2];
    const samples = task.toolAccess.samples ?? 12;
    let firstFailure: string | null = null;
    let targetSampled = 0;
    for (let step = 0; step <= samples; step += 1) {
      const contactOffset = task.toolAccess.fromMm - (task.toolAccess.fromMm - task.toolAccess.contactMm) * (step / samples);
      const tipOffset = maxProjection + contactOffset - centerProjection;
      const tip: [number, number, number] = [center[0] + approach.direction[0] * tipOffset, center[1] + approach.direction[1] * tipOffset, center[2] + approach.direction[2] * tipOffset];
      const tool = toolMeshAt(tip, approach.direction, task.toolAccess.toolRadiusMm, 8);
      for (const instance of instanceById.values()) {
        if (instance.id === target.id) continue;
        const mesh = meshes.get(instance.id);
        if (!mesh) continue;
        targetSampled += 1;
        const result = meshesIntersect(tool, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], mesh, instance.transform as number[], { maxPairTests: 200_000 });
        if (result.status !== "SEPARATED" && firstFailure === null) firstFailure = `step ${step}/${samples}: tool intersects ${instance.id} (${result.status}).`;
      }
      if (step === samples) {
        const contactResult = meshesIntersect(tool, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], targetMesh, target.transform as number[], { maxPairTests: 200_000 });
        if (contactResult.status !== "SEPARATED" && firstFailure === null) firstFailure = `final tool position intersects the target (${contactResult.status}).`;
      }
    }
    const gapMm = task.toolAccess.contactMm;
    const tolerance = task.toolAccess.contactToleranceMm ?? 0.5;
    sampled += targetSampled;
    if (firstFailure === null && gapMm > tolerance) firstFailure = `final tip gap ${gapMm.toFixed(3)} mm exceeds the contact tolerance ${tolerance} mm.`;
    if (firstFailure) anyFailure = true;
    approaches.push({ id: approach.id, instanceId: approach.instanceId, status: firstFailure ? "FAIL" : "PASS", gapMm, sampled: targetSampled, firstFailure });
  }
  return {
    status: "PASS", reason: anyFailure ? "At least one declared tool approach is blocked." : "Every declared tool approach reaches its target without sampled collision.", sampled, approaches,
  };
}

export async function scoreProductSubmission(task: ProductTask, submission: Submission): Promise<ProductReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = ["A PASS covers product preparation layers only: distinct selectors, part connectivity, export reconstruction, declared paths where present, and the layers listed by the task.", "Rigid motion and source-driven poses are sampled at the declared protocol angles; they are not continuous motion, contact tolerance, load, friction or physical function.", "Source-driven pose verification has a fixed wall-clock budget; a loaded host can return an honest NOT_RUN, which is not a pass.", "The product's A001 contract gate remains separate; this is not a user acceptance or physical-function verdict."];
  const empty: ProductMeasurements = { parts: 0, partStatuses: [], topology: null, reconstruction: null, disassembly: null, assembly: null, fitStatuses: [], reconstructionReason: null, disassemblyReason: null, assemblyReason: null, motion: null, motionReason: null, sourceMotion: null, sourceMotionReason: null, sourceMotionNine: null, sourceMotionNineReason: null, sourceMotionNineAnglesDeg: null, toolAccess: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: ProductMeasurements): ProductReport => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "product-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): ProductReport => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  const extracted = extractEmbeddedAssemblySpec(submission.source);
  if (extracted.status !== "valid") return blocked(`The source carries no valid embedded declaration: ${extracted.status === "invalid" ? extracted.reason : "absent"}`);
  const parsed = validateAssemblySpec(extracted.spec);
  if (!parsed.success) return blocked(`The embedded declaration is invalid: ${parsed.error.message}`);
  const fitRequirements = task.fit ? task.fit.requirements.map((required) => {
    const connection = parsed.data.connections.find((entry) => entry.id === required.connectionId);
    if (!connection) fail(`fit connection ${required.connectionId} is not declared`);
    if (connection.type !== "revolute") fail(`fit connection ${required.connectionId} must be revolute`);
    const instance = parsed.data.instances.find((entry) => {
      const part = parsed.data.parts.find((candidate) => candidate.id === entry.partId);
      return part?.selector === required.boreSelector;
    });
    if (!instance) fail(`fit bore selector ${required.boreSelector} is not a declared instance`);
    return { connectionId: connection.id, boreInstanceId: instance.id, diametralClearanceMm: { min: task.fit!.minClearanceMm, max: task.fit!.maxClearanceMm }, ...(connection.fitStationsMm ? { stationsMm: connection.fitStationsMm } : {}) };
  }) : undefined;
  // A task may carry the natural-language request it was derived from. In that
  // case the real product path derives the multi-joint contract and measures the
  // layers the contract asks for. The gate reason records measurement attribution
  // only; it is not user confirmation, acceptance or a product contract.
  const contract = task.request ? deriveRequirementContract({ request: task.request }) : null;
  let prepared: Awaited<ReturnType<typeof prepareContractAssembly>>;
  try { prepared = await prepareContractAssembly({
    scadSource: submission.source, spec: parsed.data,
    ...(fitRequirements ? { fitRequirements } : {}),
    ...(contract ? {
      contractSnapshot: { contract, request: task.request! },
      contractGate: { evidenceCurrent: true, reason: PRODUCT_BENCH_TRIAL_GATE_REASON },
      sourceSamplingSeed: sha256(`${task.id}\0${submission.source}`).slice(0, 32),
    } : {}),
  }); }
  catch (error) { return blocked(`prepareContractAssembly failed: ${error instanceof Error ? error.message : String(error)}`); }
  const m = prepared.manifest as unknown as Record<string, unknown>;
  const evidence = (m.evidence && typeof m.evidence === "object" ? m.evidence : {}) as Record<string, unknown>;
  const reasonOf = (value: unknown): string | null => value && typeof value === "object" && typeof (value as { reason?: unknown }).reason === "string" ? (value as { reason: string }).reason : null;
  const connectivity = Array.isArray(m.partConnectivity) ? m.partConnectivity as Array<Record<string, unknown>> : [];
  const partStatuses = connectivity.map((entry) => statusOf(entry) ?? "UNKNOWN");
  const topology = statusOf(m.evidence && typeof m.evidence === "object" ? (m.evidence as Record<string, unknown>).topology : null) ?? (partStatuses.length && partStatuses.every((s) => s === "PASS") ? "PASS" : partStatuses.length ? "FAIL" : null);
  const reconstruction = statusOf(m.reconstruction);
  const disassembly = statusOf(m.declaredDisassembly);
  const assembly = statusOf(m.declaredAssembly);
  const fitStatuses = Array.isArray(m.fits) ? (m.fits as Array<Record<string, unknown>>).map((fit) => ({ connectionId: String(fit.connectionId ?? "?"), status: statusOf(fit), joint: statusOf(fit.jointFrames), reason: typeof fit.reason === "string" ? fit.reason : null })) : [];
  const motion = statusOf(evidence.rigidMotion);
  const sourceMotion = statusOf(evidence.sourceMotion);
  let sourceMotionNine: { status: string; reason: string | null; angles: number[] } | null = null;
  if (task.sourcePoses) {
    const kinematics = automaticSliderCrankKinematics(parsed.data);
    const motion = kinematics ? parsed.data.motions.find((item) => item.inputConnectionId === kinematics.crankAxisConnectionId) : undefined;
    const range = motion?.range;
    if (!range || range.unit !== "deg" || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) {
      sourceMotionNine = { status: "NOT_RUN", reason: "No declared degree motion range for the extra-pose verification.", angles: [] };
    } else {
      const count = task.sourcePoses.count;
      const anglesDeg = task.sourcePoses.anglesDeg ?? Array.from({ length: count }, (_, index) => range.min + (range.max - range.min) * index / (count - 1));
      const built = buildSliderCrankSourcePoseProtocolFromSpec({ spec: parsed.data, anglesDeg, budgetMs: task.sourcePoses.budgetMs ?? 120000 });
      if (built.status !== "READY") {
        sourceMotionNine = { status: "NOT_RUN", reason: built.reason, angles: anglesDeg };
      } else {
        try {
          const verified = await verifySourcePoses({ scadSource: submission.source, spec: parsed.data, ...built.protocol });
          const failedPoses = verified.results.filter((result) => result.status !== "PASS");
          const reason = failedPoses.length === 0
            ? `Every one of the ${anglesDeg.length} listed source poses matched the independently derived expectation.`
            : failedPoses.slice(0, 3).map((result) => `${result.id}: ${result.status} ${result.reason}`).join(" | ");
          sourceMotionNine = { status: verified.status, reason, angles: anglesDeg };
        } catch (error) {
          sourceMotionNine = { status: "ERROR", reason: error instanceof Error ? error.message : String(error), angles: anglesDeg };
        }
      }
    }
  }
  const toolAccess = await measureToolAccess(task, submission, parsed.data);
  const measurements: ProductMeasurements = { parts: connectivity.length, partStatuses, topology, reconstruction, disassembly, assembly, fitStatuses, reconstructionReason: reasonOf(m.reconstruction), disassemblyReason: reasonOf(m.declaredDisassembly), assemblyReason: reasonOf(m.declaredAssembly), motion, motionReason: reasonOf(evidence.rigidMotion), sourceMotion, sourceMotionReason: reasonOf(evidence.sourceMotion), sourceMotionNine: sourceMotionNine?.status ?? null, sourceMotionNineReason: sourceMotionNine?.reason ?? null, sourceMotionNineAnglesDeg: sourceMotionNine?.angles ?? null, toolAccess };
  const artifactSha256 = sourceSha256;
  const toolVersion = `product-bench/1 openscad:${openscadVersion()}`;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: topology !== null ? "MEASURED" : "NOT_RUN", value: connectivity.length, artifactSha256, method: "Product partConnectivity array length after selector rendering.", toolVersion, coverage: `${connectivity.length} part(s) measured by prepareContractAssembly.` };
  const topologyObservation: Observation = { id: "part-connectivity", status: topology === null ? "NOT_RUN" : "MEASURED", ...(topology === null ? {} : { value: topology === "PASS" }), artifactSha256, method: "Product partConnectivity verdicts for every rendered part.", toolVersion, coverage: `${partStatuses.length} part(s): ${partStatuses.join(", ") || "none"}.`, ...(topology === "PASS" ? {} : { reason: `partConnectivity statuses ${partStatuses.join(", ") || "missing"}.` }) };
  const reconstructionObservation: Observation = { id: "assembly-reconstruction", status: reconstruction === null ? "NOT_RUN" : reconstruction === "PASS" || reconstruction === "FAIL" ? "MEASURED" : "NOT_RUN", ...(reconstruction === "PASS" || reconstruction === "FAIL" ? { value: reconstruction === "PASS" } : {}), artifactSha256, method: "Product reconstruction of delivered part triangles into the placed assembly.", toolVersion, coverage: "One product reconstruction layer.", ...(reconstruction === "PASS" ? {} : { reason: measurements.reconstructionReason ?? `reconstruction ${reconstruction ?? "missing"}.` }) };
  const disassemblyObservation: Observation = { id: "disassembly-path", status: disassembly === null ? "NOT_RUN" : disassembly === "PASS" || disassembly === "FAIL" ? "MEASURED" : "NOT_RUN", ...(disassembly === "PASS" || disassembly === "FAIL" ? { value: disassembly === "PASS" } : {}), artifactSha256, method: "Product declaredDisassembly on the submitted declaration and rendered part meshes.", toolVersion, coverage: "One declared removal order.", ...(disassembly === "PASS" ? {} : { reason: measurements.disassemblyReason ?? `declaredDisassembly ${disassembly ?? "missing"}.` }) };
  const assemblyObservation: Observation = { id: "assembly-path", status: assembly === null ? "NOT_RUN" : assembly === "PASS" || assembly === "FAIL" ? "MEASURED" : "NOT_RUN", ...(assembly === "PASS" || assembly === "FAIL" ? { value: assembly === "PASS" } : {}), artifactSha256, method: "Product declaredAssembly via reversed removal paths.", toolVersion, coverage: "One declared insertion order.", ...(assembly === "PASS" ? {} : { reason: measurements.assemblyReason ?? `declaredAssembly ${assembly ?? "missing"}.` }) };
  const fitValues = fitStatuses.map((fit) => fit.status);
  const fitAllPass = fitStatuses.length > 0 && fitValues.every((status) => status === "PASS");
  const fitMeasured = fitStatuses.length > 0 && fitValues.every((status) => status === "PASS" || status === "FAIL");
  const jointValues = fitStatuses.map((fit) => fit.joint);
  const jointMeasured = jointValues.length > 0 && jointValues.every((status) => status === "PASS" || status === "FAIL");
  const jointPass = jointValues.length > 0 && jointValues.every((status) => status === "PASS");
  const jointObservation: Observation = { id: "measured-joint-frames", status: !jointMeasured ? "NOT_RUN" : "MEASURED", ...(jointMeasured ? { value: jointPass } : {}), artifactSha256, method: "Product joint-frame verdicts for measured revolute fits.", toolVersion, coverage: `${fitStatuses.length} fit(s): ${fitStatuses.map((fit) => `${fit.connectionId}:${fit.joint ?? "?"}`).join(", ") || "none"}.`, ...(jointPass ? {} : { reason: "At least one measured joint frame did not agree." }) };
  const fitObservation: Observation = { id: "diametral-clearance", status: fitStatuses.length === 0 ? "NOT_RUN" : fitMeasured ? "MEASURED" : "NOT_RUN", ...(fitMeasured ? { value: fitAllPass } : {}), artifactSha256, method: "Product revolute fit measurements at declared stations for the task clearance band.", toolVersion, coverage: `${fitStatuses.length} revolute fit(s): ${fitStatuses.map((fit) => `${fit.connectionId}:${fit.status ?? "?"}`).join(", ") || "none"}.`, ...(fitAllPass ? {} : { reason: fitStatuses.filter((fit) => fit.status !== "PASS").map((fit) => `${fit.connectionId}: ${fit.reason ?? fit.status}`).join(" | ") || "No revolute fits were measured." }) };
  const measuredStatus = (status: string | null): { status: Observation["status"]; value?: boolean } => {
    if (status === "PASS" || status === "FAIL") return { status: "MEASURED", value: status === "PASS" };
    return { status: status === "ERROR" ? "ERROR" : "NOT_RUN" };
  };
  const motionObservation: Observation = { id: "rigid-motion", ...measuredStatus(motion), artifactSha256, method: "Product rigid sampled motion evidence from prepareContractAssembly.", toolVersion, coverage: motion === null ? "No rigid motion evidence." : `Product rigid-motion status ${motion}.`, ...(motion === "PASS" ? {} : { reason: measurements.motionReason ?? `rigidMotion ${motion ?? "missing"}.` }) };
  const sourceMotionObservation: Observation = { id: "source-motion", ...measuredStatus(sourceMotion), artifactSha256, method: "Product source-driven pose verification from prepareContractAssembly.", toolVersion, coverage: sourceMotion === null ? "No source-motion evidence." : `Product source-motion status ${sourceMotion}.`, ...(sourceMotion === "PASS" ? {} : { reason: measurements.sourceMotionReason ?? `sourceMotion ${sourceMotion ?? "missing"}.` }) };
  const nineStatus = sourceMotionNine?.status ?? null;
  const nineObservation: Observation = nineStatus === null
    ? { id: "source-motion-nine", status: "NOT_RUN", reason: "No sourcePoses contract declared for this task." }
    : { id: "source-motion-nine", ...measuredStatus(nineStatus), artifactSha256, method: "Independent source-pose verification at the declared extra poses using the production slider-crank protocol.", toolVersion, coverage: `${sourceMotionNine?.angles.length ?? 0} listed input(s): ${(sourceMotionNine?.angles ?? []).map((angle) => `${Number(angle.toFixed(3))}°`).join(", ")}.`, ...(nineStatus === "PASS" ? {} : { reason: sourceMotionNine?.reason ?? `sourceMotionNine ${nineStatus}.` }) };
  const toolStatus = toolAccess?.status ?? null;
  const toolPass = !!toolAccess && toolAccess.status === "PASS" && toolAccess.approaches.every((entry) => entry.status === "PASS");
  const toolObservation: Observation = toolAccess === null
    ? { id: "tool-access", status: "NOT_RUN", reason: "No toolAccess contract declared for this task." }
    : { id: "tool-access", ...measuredStatus(toolStatus), ...(toolStatus === "PASS" ? { value: toolPass } : {}), artifactSha256, method: "Sampled cylindrical-tool sweep from outside toward each declared instance along the declared direction.", toolVersion, coverage: `${toolAccess.approaches.length} approach(es), ${toolAccess.sampled} instance-pair sample(s).`, ...(toolPass ? {} : { reason: toolAccess.reason || toolAccess.approaches.find((entry) => entry.firstFailure)?.firstFailure || "A tool approach is blocked." }) };
  const observations: Record<string, Observation> = { "tool-access": toolObservation, "source-motion-nine": nineObservation, "distinct-exported-parts": distinctObservation, "part-connectivity": topologyObservation, "assembly-reconstruction": reconstructionObservation, "assembly-path": assemblyObservation, "disassembly-path": disassemblyObservation, "diametral-clearance": fitObservation, "measured-joint-frames": jointObservation, "rigid-motion": motionObservation, "source-motion": sourceMotionObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
