/**
 * L5b/L5c V8 phase/packaging carrier family: eight cylinders in four 90-degree
 * phase groups, two rods per shared crankpin, and a required connected
 * crankshaft (pins joined to main journals by webs). The original task keeps a
 * base-plate frame; the later block/bearing rung requires a crankcase block with
 * measured main bearings and a continuous top rail. Neither task models
 * cylinder bores, counterweights or firing order, so this is not a complete V8.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { meshesIntersect } from "../../src/lib/geometry/mesh-collision";
import { checkPartConnectivity } from "../../src/lib/assembly/part-connectivity";
import { measureRevoluteFit } from "../../src/lib/assembly/fit-measurement";
import { renderAssemblyParts, type RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface V8Selectors { frame: string; crank: string; rods: string[]; sliders: string[] }
export interface V8Contract {
  crankRadiusMm: number; rodLengthMm: number; vHalfAngleDeg: number; bankYmm: number;
  stationsY: number[]; phasesDeg: number[]; sliderToleranceMm: number;
}
export interface V8BearingContract {
  /** Axial stations measured on both the block bore and the crankshaft journals. */
  stationsY: number[];
  minClearanceMm: number;
  maxClearanceMm: number;
  maxAxisOffsetMm: number;
}
export interface V8CounterweightContract {
  /** Web plane measured at station + offset (the throw-side web). */
  webOffsetMm: number;
  /** Counterweight material must reach at least this radius opposite the pin. */
  minOppositeRadiusMm: number;
  /** Material toward the pin must stay inside this radius. */
  maxPinSideRadiusMm: number;
  /** Half-angle of the pin-side and opposite sectors, in degrees. */
  angleToleranceDeg: number;
}
export interface V8BenchTask { schemaVersion: 1; id: string; prompt: string; selectors: V8Selectors; motionParameter: string; angles: number[]; contract: V8Contract; bearingFit?: V8BearingContract; counterweight?: V8CounterweightContract; requirements: BenchRequirement[]; notes?: string[] }
export interface V8CaseMeasurements {
  parts: Array<{ id: string; triangleCount: number }>;
  angles: number[];
  sliderCenters: Array<{ angleDeg: number; index: number; actual: [number, number, number]; expected: [number, number, number] }>;
  maxPositionErrorMm: number | null;
  collision: { sampled: number; separated: number; firstFailure: string | null };
  /** Exact edge connectivity of the crank part at 0 degrees; null when not measured. */
  crankConnectivity: { status: EvidenceStatus; reason: string; components: number } | null;
  /** Exact edge connectivity of the frame/block part at 0 degrees; null when not measured. */
  frameConnectivity: { status: EvidenceStatus; reason: string; components: number } | null;
  /** Measured main-bearing fit between the block bore and the crankshaft journals. */
  bearingFit: {
    status: EvidenceStatus; reason: string; stationsMm: number[];
    clearanceMm: { min: number; max: number } | null; axisOffsetMm: number | null;
  } | null;
  /** Measured counterweight presence/phase on the crank web planes. */
  counterweight: {
    status: EvidenceStatus; reason: string; passed: boolean;
    stations: Array<{ stationIndex: number; webY: number; oppositeMaxRadiusMm: number; pinSideMaxRadiusMm: number }>;
  } | null;
}
export interface V8CaseReport {
  schemaVersion: "v8-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: V8CaseMeasurements; provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
function identifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(`${field} must be an identifier`); return value; }
export function validateV8Task(value: unknown): V8BenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const frame = identifier(s.frame, "selectors.frame"), crank = identifier(s.crank, "selectors.crank");
  if (!Array.isArray(s.rods) || s.rods.length !== 8) fail("selectors.rods must have 8 entries");
  if (!Array.isArray(s.sliders) || s.sliders.length !== 8) fail("selectors.sliders must have 8 entries");
  const rods = s.rods.map((entry, index) => identifier(entry, `selectors.rods[${index}]`));
  const sliders = s.sliders.map((entry, index) => identifier(entry, `selectors.sliders[${index}]`));
  if (new Set([frame, crank, ...rods, ...sliders]).size !== 18) fail("selectors must be 18 distinct identifiers");
  if (typeof raw.motionParameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.motionParameter) || ["agentscad_part", "agentscad_pose"].includes(raw.motionParameter)) fail("motionParameter is invalid");
  if (!Array.isArray(raw.angles) || raw.angles.length < 3 || raw.angles.length > 24) fail("angles must have 3 to 24 entries");
  const angles = raw.angles.map((entry) => finite(entry, "angles[]"));
  if (new Set(angles).size !== angles.length || !angles.includes(0)) fail("angles must be distinct and include 0");
  if (!raw.contract || typeof raw.contract !== "object") fail("contract must be an object");
  const c = raw.contract as Record<string, unknown>;
  const contract: V8Contract = {
    crankRadiusMm: finite(c.crankRadiusMm, "contract.crankRadiusMm"), rodLengthMm: finite(c.rodLengthMm, "contract.rodLengthMm"),
    vHalfAngleDeg: finite(c.vHalfAngleDeg, "contract.vHalfAngleDeg"), bankYmm: finite(c.bankYmm, "contract.bankYmm"),
    stationsY: Array.isArray(c.stationsY) ? c.stationsY.map((entry) => finite(entry, "contract.stationsY[]")) : fail("contract.stationsY must be an array"),
    phasesDeg: Array.isArray(c.phasesDeg) ? c.phasesDeg.map((entry) => finite(entry, "contract.phasesDeg[]")) : fail("contract.phasesDeg must be an array"),
    sliderToleranceMm: finite(c.sliderToleranceMm, "contract.sliderToleranceMm"),
  };
  if (contract.stationsY.length !== 4 || contract.phasesDeg.length !== 4) fail("contract must have 4 stations and 4 phases");
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > contract.crankRadiusMm)) fail("invalid crank/rod dimensions");
  if (!(contract.vHalfAngleDeg > 0) || !(contract.vHalfAngleDeg < 90) || !(contract.bankYmm > 0) || !(contract.sliderToleranceMm > 0)) fail("invalid contract bounds");
  let bearingFit: V8BearingContract | undefined;
  if (raw.bearingFit !== undefined) {
    if (!raw.bearingFit || typeof raw.bearingFit !== "object") fail("bearingFit must be an object");
    const b = raw.bearingFit as Record<string, unknown>;
    const stationsY = Array.isArray(b.stationsY) ? b.stationsY.map((entry) => finite(entry, "bearingFit.stationsY[]")) : fail("bearingFit.stationsY must be an array");
    if (stationsY.length < 1 || stationsY.length > 4) fail("bearingFit must have 1 to 4 stations");
    const minClearanceMm = finite(b.minClearanceMm, "bearingFit.minClearanceMm");
    const maxClearanceMm = finite(b.maxClearanceMm, "bearingFit.maxClearanceMm");
    const maxAxisOffsetMm = finite(b.maxAxisOffsetMm, "bearingFit.maxAxisOffsetMm");
    if (!(minClearanceMm >= 0) || !(maxClearanceMm >= minClearanceMm) || !(maxAxisOffsetMm > 0)) fail("bearingFit bounds are invalid");
    bearingFit = { stationsY, minClearanceMm, maxClearanceMm, maxAxisOffsetMm };
  }
  let counterweight: V8CounterweightContract | undefined;
  if (raw.counterweight !== undefined) {
    if (!raw.counterweight || typeof raw.counterweight !== "object") fail("counterweight must be an object");
    const b = raw.counterweight as Record<string, unknown>;
    const webOffsetMm = finite(b.webOffsetMm, "counterweight.webOffsetMm");
    const minOppositeRadiusMm = finite(b.minOppositeRadiusMm, "counterweight.minOppositeRadiusMm");
    const maxPinSideRadiusMm = finite(b.maxPinSideRadiusMm, "counterweight.maxPinSideRadiusMm");
    const angleToleranceDeg = finite(b.angleToleranceDeg, "counterweight.angleToleranceDeg");
    if (!(webOffsetMm > 0) || !(minOppositeRadiusMm > maxPinSideRadiusMm) || !(maxPinSideRadiusMm > 0) || !(angleToleranceDeg > 0) || !(angleToleranceDeg < 90)) fail("counterweight bounds are invalid");
    counterweight = { webOffsetMm, minOppositeRadiusMm, maxPinSideRadiusMm, angleToleranceDeg };
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
  if (new Set(requirements.map((r) => r.id)).size !== requirements.length) fail("duplicate requirement id");
  const observable = new Set(["distinct-exported-parts", "measured-joint-frames", "sampled-motion", "source-motion", "part-connectivity", "frame-connectivity", "bearing-fit", "counterweight-balance"]);
  for (const r of requirements) if (!observable.has(r.id)) fail(`requirement ${r.id} has no observer`);
  if (requirements.some((r) => r.id === "bearing-fit") && !bearingFit) fail("a bearing-fit requirement needs a bearingFit contract");
  if (requirements.some((r) => r.id === "counterweight-balance") && !counterweight) fail("a counterweight-balance requirement needs a counterweight contract");
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 18) fail("distinct-exported-parts must equal 18");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors: { frame, crank, rods, sliders }, motionParameter: raw.motionParameter, angles, contract, ...(bearingFit ? { bearingFit } : {}), ...(counterweight ? { counterweight } : {}), requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function v8TasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function v8SubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadV8Tasks(root = v8TasksDirectory()): Promise<V8BenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: V8BenchTask[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validateV8Task(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no V8 tasks under ${root}`);
  return tasks;
}
export async function loadV8Submissions(taskId: string, root = v8SubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
function canonicalMeshHash(mesh: TriangleMesh): string {
  const triangles: string[] = [];
  for (let index = 0; index < mesh.triangleCount; index += 1) { const corners: string[] = []; for (let corner = 0; corner < 3; corner += 1) { const base = index * 9 + corner * 3; corners.push(`${mesh.coordinates[base].toFixed(4)},${mesh.coordinates[base+1].toFixed(4)},${mesh.coordinates[base+2].toFixed(4)}`); } triangles.push(corners.sort().join("|")); }
  return sha256(triangles.sort().join("\n"));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
export function expectedV8Center(contract: V8Contract, stationIndex: number, side: 0 | 1, angleDeg: number): [number, number, number] {
  const half = contract.vHalfAngleDeg * Math.PI / 180; const ux = Math.sin(half); const uz = Math.cos(half);
  const sx = side === 0 ? ux : -ux; const theta = (angleDeg + contract.phasesDeg[stationIndex]) * Math.PI / 180;
  const px = contract.crankRadiusMm * Math.sin(theta); const pz = contract.crankRadiusMm * Math.cos(theta);
  const along = px * sx + pz * uz;
  const s = along + Math.sqrt(contract.rodLengthMm ** 2 - (px * px + pz * pz - along ** 2));
  return [s * sx, contract.stationsY[stationIndex] + (side === 0 ? -contract.bankYmm : contract.bankYmm), s * uz];
}
/**
 * Measured main-bearing fit: the block is the bore side and the crankshaft the
 * shaft side, at the task's declared axial stations. The synthetic two-instance
 * declaration exists only to feed the shared cylindrical-feature measurement; it
 * is not a product contract and no user intent is inferred from it.
 */
function measureBearingFit(task: V8BenchTask, frame: RenderedAssemblyPart, crank: RenderedAssemblyPart): V8CaseMeasurements["bearingFit"] {
  if (!task.bearingFit) return null;
  const identity = IDENTITY;
  const spec = {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: [
      { id: "block", name: "Block", selector: task.selectors.frame, source: "generated", material: null },
      { id: "crank", name: "Crank", selector: task.selectors.crank, source: "generated", material: null },
    ],
    instances: [
      { id: "block1", partId: "block", subassemblyId: null, transform: identity },
      { id: "crank1", partId: "crank", subassemblyId: null, transform: identity },
    ],
    subassemblies: [],
    connections: [{ id: "main_bearings", type: "revolute", a: "block1", b: "crank1",
      frameA: { origin: [0, 0, 0], direction: [0, 1, 0] }, frameB: { origin: [0, 0, 0], direction: [0, 1, 0] },
      range: null, pitchMm: null, ratio: null, boreInstanceId: "block1", allowedContact: [], fitStationsMm: task.bearingFit.stationsY }],
    groundedInstanceId: "block1", motions: [], operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
  const measured = measureRevoluteFit({
    spec, connectionId: "main_bearings",
    meshes: { block: frame.stl, crank: crank.stl },
    boreInstanceId: "block1", stationsMm: task.bearingFit.stationsY, maxRadiusMm: 6,
  });
  const status: EvidenceStatus = measured.status === "MEASURED" ? "PASS"
    : measured.status === "ERROR" ? "ERROR" : "NOT_RUN";
  return {
    status, reason: measured.reason, stationsMm: measured.stationsMm,
    clearanceMm: measured.clearanceMm,
    axisOffsetMm: measured.axis?.offsetMm ?? null,
  };
}

/**
 * Counterweight evidence: on each declared throw-side web plane, the crank must
 * carry material beyond the pin-side limit only in the sector opposite the throw.
 * This is a geometric presence/phase check, not a mass moment or balance-factor
 * calculation.
 */
function measureCounterweights(task: V8BenchTask, crankStl: Buffer): V8CaseMeasurements["counterweight"] {
  if (!task.counterweight) return null;
  let mesh: TriangleMesh;
  try { mesh = readBinaryStl(crankStl); } catch (error) { return { status: "ERROR", reason: error instanceof Error ? error.message : "Invalid crank mesh", passed: false, stations: [] }; }
  const tol = task.counterweight.angleToleranceDeg * Math.PI / 180;
  const stations: NonNullable<V8CaseMeasurements["counterweight"]>["stations"] = [];
  let passed = true;
  let reason = "Every declared web plane carries counterweight material opposite its throw and stays clear on the pin side.";
  for (let index = 0; index < task.contract.stationsY.length; index += 1) {
    const webY = task.contract.stationsY[index] + task.counterweight.webOffsetMm;
    const angle = task.contract.phasesDeg[index] * Math.PI / 180;
    const pinX = Math.sin(angle), pinZ = Math.cos(angle);
    let oppositeMax = 0, pinSideMax = 0, samples = 0;
    for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const base = triangle * 9 + corner * 3;
        const x = mesh.coordinates[base], y = mesh.coordinates[base + 1], z = mesh.coordinates[base + 2];
        if (Math.abs(y - webY) > 0.6) continue;
        const radius = Math.hypot(x, z);
        if (radius < 1e-6) continue;
        samples += 1;
        const cos = (x * pinX + z * pinZ) / radius;
        const deviation = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (deviation <= tol) pinSideMax = Math.max(pinSideMax, radius);
        if (deviation >= Math.PI - tol) oppositeMax = Math.max(oppositeMax, radius);
      }
    }
    stations.push({ stationIndex: index, webY, oppositeMaxRadiusMm: oppositeMax, pinSideMaxRadiusMm: pinSideMax });
    if (samples < 50) { passed = false; reason = `Not enough crank material sampled on the web plane at y=${webY.toFixed(2)} mm.`; continue; }
    if (oppositeMax < task.counterweight.minOppositeRadiusMm) { passed = false; reason = `Counterweight material opposite the throw at y=${webY.toFixed(2)} mm reaches only ${oppositeMax.toFixed(2)} mm, below the declared ${task.counterweight.minOppositeRadiusMm} mm.`; }
    if (pinSideMax > task.counterweight.maxPinSideRadiusMm) { passed = false; reason = `Crank material on the pin side at y=${webY.toFixed(2)} mm reaches ${pinSideMax.toFixed(2)} mm, above the declared ${task.counterweight.maxPinSideRadiusMm} mm.`; }
  }
  return { status: "PASS", reason, passed, stations };
}

export async function scoreV8Submission(task: V8BenchTask, submission: Submission): Promise<V8CaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = ["A PASS covers five crank angles and pairwise triangle collision; it is not continuous motion, load, friction, wear or physical function.", "This is a V8 phase/packaging family: the base task has a base-plate frame, the block/bearing task adds a two-bearing crankcase block with a top rail. Neither models cylinder bores, counterweights or firing order.", "Connectivity is exact edge connectivity of one rendered part at 0 degrees: it is not balance, strength, machining or a complete cylinder block.", "The bearing fit measures a sampled cylindrical clearance between the block bore and the crankshaft journals at the declared stations only; it is not a calibrated tolerance, bearing load rating, lubrication or manufacturability proof.", "Counterweight balance is measured as material extent on the crank web planes relative to each throw direction; it is not a mass moment, balance factor, stress or fatigue calculation.", "Slider centres come from mesh bounds; the 0.1 mm tolerance is a mesh value."];
  const empty: V8CaseMeasurements = { parts: [], angles: task.angles, sliderCenters: [], maxPositionErrorMm: null, collision: { sampled: 0, separated: 0, firstFailure: null }, crankConnectivity: null, frameConnectivity: null, bearingFit: null, counterweight: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: V8CaseMeasurements): V8CaseReport => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "v8-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): V8CaseReport => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  const partIds = ["frame", "crank", ...task.selectors.rods, ...task.selectors.sliders];
  const renderParts = (angle: number) => renderAssemblyParts({ scadSource: submission.source, parameters: { [task.motionParameter]: angle }, parts: partIds.map((id) => ({ partId: id, selector: id })) });
  let zeroParts: RenderedAssemblyPart[];
  try { zeroParts = await renderParts(0); } catch (error) { return blocked(`The 18 instance meshes did not render at 0°: ${error instanceof Error ? error.message : String(error)}`); }
  const zeroMeshes = zeroParts.map((part) => ({ part, mesh: readBinaryStl(part.stl) }));
  const crankPart = zeroParts.find((part) => part.partId === task.selectors.crank);
  const crankConnectivity = crankPart ? checkPartConnectivity(crankPart.stl) : null;
  const framePart = zeroParts.find((part) => part.partId === task.selectors.frame);
  const frameConnectivity = framePart ? checkPartConnectivity(framePart.stl) : null;
  const bearingFit = task.bearingFit && framePart && crankPart
    ? measureBearingFit(task, framePart, crankPart)
    : null;
  const counterweight = task.counterweight && crankPart ? measureCounterweights(task, crankPart.stl) : null;
  const measurements: V8CaseMeasurements = { ...empty, parts: zeroParts.map((part) => ({ id: part.partId, triangleCount: part.triangleCount })),
    crankConnectivity: crankConnectivity === null ? null : {
      status: crankConnectivity.status as EvidenceStatus,
      reason: crankConnectivity.reason, components: crankConnectivity.components.length,
    },
    frameConnectivity: frameConnectivity === null ? null : {
      status: frameConnectivity.status as EvidenceStatus,
      reason: frameConnectivity.reason, components: frameConnectivity.components.length,
    },
    bearingFit, counterweight };
  const artifactSha256 = sha256(zeroParts.map((part) => part.sha256).join(":"));
  const distinct = new Set(zeroMeshes.map(({ mesh }) => canonicalMeshHash(mesh))).size;
  let collisionSampled = 0, collisionSeparated = 0, firstFailure: string | null = null, maxPositionError = 0;
  const centerOf = (parts: RenderedAssemblyPart[], id: string) => { const part = parts.find((p) => p.partId === id); if (!part) throw new Error(`missing ${id}`); const b = meshBounds(readBinaryStl(part.stl)); return [(b.min[0]+b.max[0])/2, (b.min[1]+b.max[1])/2, (b.min[2]+b.max[2])/2] as [number, number, number]; };
  for (const angle of task.angles) {
    let parts: RenderedAssemblyPart[];
    try { parts = angle === 0 ? zeroParts : await renderParts(angle); } catch (error) { return blocked(`The 18 instance meshes did not render at ${angle}°: ${error instanceof Error ? error.message : String(error)}`); }
    for (let station = 0; station < 4; station += 1) for (const side of [0, 1] as const) {
      const index = station * 2 + side;
      const actual = centerOf(parts, task.selectors.sliders[index]);
      const expected = expectedV8Center(task.contract, station, side, angle);
      measurements.sliderCenters.push({ angleDeg: angle, index, actual, expected });
      maxPositionError = Math.max(maxPositionError, Math.hypot(actual[0]-expected[0], actual[1]-expected[1], actual[2]-expected[2]));
    }
    const meshes = parts.map((part) => readBinaryStl(part.stl));
    for (let i = 0; i < parts.length; i += 1) for (let j = i+1; j < parts.length; j += 1) {
      collisionSampled += 1;
      const result = meshesIntersect(meshes[i], IDENTITY, meshes[j], IDENTITY);
      if (result.status === "SEPARATED") collisionSeparated += 1; else if (!firstFailure) firstFailure = `${angle}° ${parts[i].partId}/${parts[j].partId}:${result.status}`;
    }
  }
  measurements.maxPositionErrorMm = maxPositionError;
  measurements.collision = { sampled: collisionSampled, separated: collisionSeparated, firstFailure };
  const positionOk = maxPositionError <= task.contract.sliderToleranceMm;
  const collisionOk = collisionSampled > 0 && collisionSeparated === collisionSampled;
  const toolVersion = `v8-bench/1 openscad:${openscadVersion()}`;
  const obs = (id: string, value: boolean, method: string, coverage: string, reason?: string): Observation => ({ id, status: "MEASURED", value, artifactSha256, method, toolVersion, coverage, ...(reason ? { reason } : {}) });
  const connectivity = measurements.crankConnectivity;
  const connectivityObservation: Observation = connectivity === null
    ? { id: "part-connectivity", status: "NOT_RUN", reason: "The crank selector rendered no mesh, so connectivity could not be measured." }
    : connectivity.status === "PASS" || connectivity.status === "FAIL"
      ? { id: "part-connectivity", status: "MEASURED", value: connectivity.status === "PASS", artifactSha256, toolVersion,
          method: "Exact STL edge connectivity and separating-slab check of the rendered crank part at 0 degrees.",
          coverage: `1 crank mesh; ${connectivity.components} edge component(s).`,
          ...(connectivity.status === "PASS" ? {} : { reason: connectivity.reason }) }
      : { id: "part-connectivity", status: connectivity.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: connectivity.reason, artifactSha256, toolVersion,
          method: "Exact STL edge connectivity and separating-slab check of the rendered crank part at 0 degrees.",
          coverage: `1 crank mesh; ${connectivity.components} edge component(s).` };
  const frameConnectivityValue = measurements.frameConnectivity;
  const frameConnectivityObservation: Observation = frameConnectivityValue === null
    ? { id: "frame-connectivity", status: "NOT_RUN", reason: "The frame selector rendered no mesh, so block connectivity could not be measured." }
    : frameConnectivityValue.status === "PASS" || frameConnectivityValue.status === "FAIL"
      ? { id: "frame-connectivity", status: "MEASURED", value: frameConnectivityValue.status === "PASS", artifactSha256, toolVersion,
          method: "Exact STL edge connectivity and separating-slab check of the rendered frame/block part at 0 degrees.",
          coverage: `1 frame mesh; ${frameConnectivityValue.components} edge component(s).`,
          ...(frameConnectivityValue.status === "PASS" ? {} : { reason: frameConnectivityValue.reason }) }
      : { id: "frame-connectivity", status: frameConnectivityValue.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: frameConnectivityValue.reason, artifactSha256, toolVersion,
          method: "Exact STL edge connectivity and separating-slab check of the rendered frame/block part at 0 degrees.",
          coverage: `1 frame mesh; ${frameConnectivityValue.components} edge component(s).` };
  const bearing = measurements.bearingFit;
  const bearingInBand = !!bearing && bearing.clearanceMm !== null && task.bearingFit !== undefined
    && bearing.clearanceMm.min >= task.bearingFit.minClearanceMm && bearing.clearanceMm.max <= task.bearingFit.maxClearanceMm
    && bearing.axisOffsetMm !== null && bearing.axisOffsetMm <= task.bearingFit.maxAxisOffsetMm;
  const bearingFitObservation: Observation = bearing === null
    ? { id: "bearing-fit", status: "NOT_RUN", reason: "No bearing-fit contract or a missing block/crank mesh prevented measurement." }
    : bearing.status === "PASS"
      ? { id: "bearing-fit", status: "MEASURED", value: bearingInBand, artifactSha256, toolVersion,
          method: "Cylindrical section measurement of the block bore against the crankshaft journals at the declared axial stations.",
          coverage: `${bearing.stationsMm.length} station(s): ${bearing.stationsMm.map((value) => value.toFixed(1)).join(", ")} mm.`,
          ...(bearingInBand ? {} : { reason: `Measured clearance ${bearing.clearanceMm?.min.toFixed(4) ?? "?"}-${bearing.clearanceMm?.max.toFixed(4) ?? "?"} mm with axis offset ${bearing.axisOffsetMm?.toFixed(4) ?? "?"} mm outside the declared band or alignment limit. ${bearing.reason}` }) }
      : { id: "bearing-fit", status: bearing.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: bearing.reason, artifactSha256, toolVersion,
          method: "Cylindrical section measurement of the block bore against the crankshaft journals at the declared axial stations.",
          coverage: `${bearing.stationsMm.length} station(s).` };
  const balance = measurements.counterweight;
  const counterweightObservation: Observation = balance === null
    ? { id: "counterweight-balance", status: "NOT_RUN", reason: "No counterweight contract or a missing crank mesh prevented measurement." }
    : balance.status === "PASS"
      ? { id: "counterweight-balance", status: "MEASURED", value: balance.passed, artifactSha256, toolVersion,
          method: "Vertex-sector extent on the declared crank web planes relative to each throw direction.",
          coverage: `${balance.stations.length} web plane(s): ${balance.stations.map((station) => `y=${station.webY.toFixed(1)} mm`).join(", ")}.`,
          ...(balance.passed ? {} : { reason: balance.reason }) }
      : { id: "counterweight-balance", status: balance.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: balance.reason, artifactSha256, toolVersion,
          method: "Vertex-sector extent on the declared crank web planes relative to each throw direction.",
          coverage: `${balance.stations.length} web plane(s).` };
  const observations: Record<string, Observation> = {
    "counterweight-balance": counterweightObservation,
    "frame-connectivity": frameConnectivityObservation,
    "bearing-fit": bearingFitObservation,
    "distinct-exported-parts": { id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256, method: "Canonical order-independent triangle hash per rendered instance.", toolVersion, coverage: `${zeroParts.length} instance meshes.`, ...(distinct === 18 ? {} : { reason: `Only ${distinct} distinct meshes.` }) },
    "measured-joint-frames": obs("measured-joint-frames", positionOk, "Eight slider centres compared with four 90-degree phase groups, ±45-degree axes.", `${task.angles.length} angles; tolerance ${task.contract.sliderToleranceMm} mm.`, positionOk ? undefined : `Max centre error ${maxPositionError.toFixed(4)} mm.`),
    "sampled-motion": obs("sampled-motion", collisionOk, "All 153 pairs of the 18 rendered instance meshes at each angle.", `${collisionSampled} pair checks.`, collisionOk ? undefined : firstFailure ?? "A pair was not sampled."),
    "source-motion": obs("source-motion", positionOk, "Actual source re-render at every angle; both banks compared with the 90-degree phase schedule.", `${task.angles.length} angles.`, positionOk ? undefined : `Source-driven positions diverge by ${maxPositionError.toFixed(4)} mm.`),
    "part-connectivity": connectivityObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
