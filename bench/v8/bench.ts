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
import { buildBvh, placeBvh, bvhIntersects } from "../../src/lib/geometry/mesh-collision";
import { nearestTriangleHit } from "../geometry";
import { checkPartConnectivity } from "../../src/lib/assembly/part-connectivity";
import { measureRevoluteFit } from "../../src/lib/assembly/fit-measurement";
import { renderAssemblyParts, type RenderedAssemblyPart } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface V8Selectors { frame: string; crank: string; rods: string[]; sliders: string[] }
export interface V8InstancePlacement { yMm: number; bankDeg: number; phaseDeg: number }
export interface V8Contract {
  crankRadiusMm: number; rodLengthMm: number; vHalfAngleDeg: number; bankYmm: number;
  stationsY: number[]; phasesDeg: number[]; sliderToleranceMm: number;
  /** Optional independent per-instance throws; when present they replace the four shared-pin stations. */
  instances?: V8InstancePlacement[];
}
export interface V8BoreClearanceContract {
  innerRadiusMm: number;
  radiusToleranceMm: number;
  minGapMm: number;
  maxGapMm: number;
}
export interface V8HeadClearanceContract { minGapMm: number; maxGapMm: number }
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
export interface V8GuideContract {
  /** Declared guide-face distance from the bank axis. */
  offsetMm: number;
  /** Allowed deviation of the measured guide face from the declared offset. */
  toleranceMm: number;
  minGapMm: number;
  maxGapMm: number;
}
export interface V8BenchTask { schemaVersion: 1; id: string; prompt: string; selectors: V8Selectors; motionParameter: string; angles: number[]; contract: V8Contract; bearingFit?: V8BearingContract; counterweight?: V8CounterweightContract; guide?: V8GuideContract; boreClearance?: V8BoreClearanceContract; headClearance?: V8HeadClearanceContract; requirements: BenchRequirement[]; notes?: string[] }
export interface V8CaseMeasurements {
  parts: Array<{ id: string; triangleCount: number }>;
  angles: number[];
  sliderCenters: Array<{ angleDeg: number; index: number; actual: [number, number, number]; expected: [number, number, number] }>;
  maxPositionErrorMm: number | null;
  collision: { sampled: number; separated: number; testedPairs: number; firstFailure: string | null };
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
  /** Measured slider-to-guide channel clearance at the sampled angles. */
  guideClearance: {
    status: EvidenceStatus; reason: string; sampled: number; missed: number;
    maxOffsetErrorMm: number | null; minGapMm: number | null; maxGapMm: number | null;
  } | null;
  /** Measured radial clearance between each slider and its closed bore at the sampled angles. */
  boreClearance: {
    status: EvidenceStatus; reason: string; sampled: number; missed: number;
    maxRadiusErrorMm: number | null; minGapMm: number | null; maxGapMm: number | null;
  } | null;
  /** Measured minimum axial gap between each slider and the bore cap/head rail. */
  headClearance: {
    status: EvidenceStatus; reason: string; sampled: number; minGapMm: number | null; maxGapMm: number | null;
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
  let instances: V8InstancePlacement[] | undefined;
  if (c.instances !== undefined) {
    if (!Array.isArray(c.instances) || c.instances.length < 2 || c.instances.length > 8) fail("contract.instances must have 2 to 8 entries");
    instances = c.instances.map((entry, index) => {
      if (!entry || typeof entry !== "object") fail(`contract.instances[${index}] must be an object`);
      const e = entry as Record<string, unknown>;
      return { yMm: finite(e.yMm, `contract.instances[${index}].yMm`), bankDeg: finite(e.bankDeg, `contract.instances[${index}].bankDeg`), phaseDeg: finite(e.phaseDeg, `contract.instances[${index}].phaseDeg`) };
    });
    if (new Set(instances.map((entry) => entry.yMm)).size !== instances.length) fail("contract.instances yMm values must be distinct");
  }
  contract.instances = instances;
  if (!instances && (contract.stationsY.length !== 4 || contract.phasesDeg.length !== 4)) fail("contract must have 4 stations and 4 phases");
  if (instances && (instances.length !== 8 || sliders.length !== 8)) fail("this bench currently requires eight selectors when instances are declared");
  if (!(contract.crankRadiusMm > 0) || !(contract.rodLengthMm > contract.crankRadiusMm)) fail("invalid crank/rod dimensions");
  if (!(contract.vHalfAngleDeg > 0) || !(contract.vHalfAngleDeg < 90) || !(contract.bankYmm > 0) || !(contract.sliderToleranceMm > 0)) fail("invalid contract bounds");
  let boreClearance: V8BoreClearanceContract | undefined;
  if (raw.boreClearance !== undefined) {
    if (!raw.boreClearance || typeof raw.boreClearance !== "object") fail("boreClearance must be an object");
    const b = raw.boreClearance as Record<string, unknown>;
    const innerRadiusMm = finite(b.innerRadiusMm, "boreClearance.innerRadiusMm");
    const radiusToleranceMm = finite(b.radiusToleranceMm, "boreClearance.radiusToleranceMm");
    const minGapMm = finite(b.minGapMm, "boreClearance.minGapMm");
    const maxGapMm = finite(b.maxGapMm, "boreClearance.maxGapMm");
    if (!(innerRadiusMm > 0) || !(radiusToleranceMm > 0) || !(minGapMm >= 0) || !(maxGapMm > minGapMm) || !(maxGapMm < innerRadiusMm)) fail("boreClearance bounds are invalid");
    boreClearance = { innerRadiusMm, radiusToleranceMm, minGapMm, maxGapMm };
  }
  let headClearance: V8HeadClearanceContract | undefined;
  if (raw.headClearance !== undefined) {
    if (!raw.headClearance || typeof raw.headClearance !== "object") fail("headClearance must be an object");
    const b = raw.headClearance as Record<string, unknown>;
    const minGapMm = finite(b.minGapMm, "headClearance.minGapMm");
    const maxGapMm = finite(b.maxGapMm, "headClearance.maxGapMm");
    if (!(minGapMm >= 0) || !(maxGapMm > minGapMm)) fail("headClearance bounds are invalid");
    headClearance = { minGapMm, maxGapMm };
  }
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
  let guide: V8GuideContract | undefined;
  if (raw.guide !== undefined) {
    if (!raw.guide || typeof raw.guide !== "object") fail("guide must be an object");
    const b = raw.guide as Record<string, unknown>;
    const offsetMm = finite(b.offsetMm, "guide.offsetMm");
    const toleranceMm = finite(b.toleranceMm, "guide.toleranceMm");
    const minGapMm = finite(b.minGapMm, "guide.minGapMm");
    const maxGapMm = finite(b.maxGapMm, "guide.maxGapMm");
    if (!(offsetMm > 0) || !(toleranceMm > 0) || !(minGapMm >= 0) || !(maxGapMm > minGapMm) || !(maxGapMm < offsetMm)) fail("guide bounds are invalid");
    guide = { offsetMm, toleranceMm, minGapMm, maxGapMm };
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
  const observable = new Set(["distinct-exported-parts", "measured-joint-frames", "sampled-motion", "source-motion", "part-connectivity", "frame-connectivity", "bearing-fit", "counterweight-balance", "guide-clearance", "bore-clearance", "head-clearance"]);
  for (const r of requirements) if (!observable.has(r.id)) fail(`requirement ${r.id} has no observer`);
  if (requirements.some((r) => r.id === "bearing-fit") && !bearingFit) fail("a bearing-fit requirement needs a bearingFit contract");
  if (requirements.some((r) => r.id === "counterweight-balance") && !counterweight) fail("a counterweight-balance requirement needs a counterweight contract");
  if (requirements.some((r) => r.id === "guide-clearance") && !guide) fail("a guide-clearance requirement needs a guide contract");
  if (requirements.some((r) => r.id === "bore-clearance") && !boreClearance) fail("a bore-clearance requirement needs a boreClearance contract");
  if (requirements.some((r) => r.id === "head-clearance") && !headClearance) fail("a head-clearance requirement needs a headClearance contract");
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 18) fail("distinct-exported-parts must equal 18");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors: { frame, crank, rods, sliders }, motionParameter: raw.motionParameter, angles, contract, ...(bearingFit ? { bearingFit } : {}), ...(counterweight ? { counterweight } : {}), ...(guide ? { guide } : {}), ...(boreClearance ? { boreClearance } : {}), ...(headClearance ? { headClearance } : {}), requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
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
/** Per-instance placement for the independent-throw contract variant (eight throws). */
export function expectedInstanceCenter(contract: V8Contract, index: number, angleDeg: number): [number, number, number] {
  const placement = contract.instances?.[index];
  if (!placement) throw new Error(`contract.instances[${index}] is missing`);
  const bank = placement.bankDeg * Math.PI / 180;
  const sx = Math.sin(bank), uz = Math.cos(bank);
  const theta = (angleDeg + placement.phaseDeg) * Math.PI / 180;
  const px = contract.crankRadiusMm * Math.sin(theta), pz = contract.crankRadiusMm * Math.cos(theta);
  const along = px * sx + pz * uz;
  const s = along + Math.sqrt(contract.rodLengthMm ** 2 - (px * px + pz * pz - along ** 2));
  return [s * sx, placement.yMm, s * uz];
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
  const unknowns = ["A PASS covers five crank angles and pairwise triangle collision; it is not continuous motion, load, friction, wear or physical function.", "This is a V8 phase/packaging family: the base task has a base-plate frame, the block/bearing task adds a two-bearing crankcase block with a top rail. Neither models cylinder bores, counterweights or firing order.", "Connectivity is exact edge connectivity of one rendered part at 0 degrees: it is not balance, strength, machining or a complete cylinder block.", "The bearing fit measures a sampled cylindrical clearance between the block bore and the crankshaft journals at the declared stations only; it is not a calibrated tolerance, bearing load rating, lubrication or manufacturability proof.", "Counterweight balance is measured as material extent on the crank web planes relative to each throw direction; it is not a mass moment, balance factor, stress or fatigue calculation.", "Guide clearance is measured by rays from each slider centre to the nearest block face at the five sampled crank angles; it is a sampled radial channel gap, not a continuous bore, ring, roundness, surface finish or wear measurement.", "Slider centres come from mesh bounds; the 0.1 mm tolerance is a mesh value."];
  const empty: V8CaseMeasurements = { parts: [], angles: task.angles, sliderCenters: [], maxPositionErrorMm: null, collision: { sampled: 0, separated: 0, testedPairs: 0, firstFailure: null }, crankConnectivity: null, frameConnectivity: null, bearingFit: null, counterweight: null, guideClearance: null, boreClearance: null, headClearance: null };
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
  let collisionSampled = 0, collisionSeparated = 0, collisionTestedPairs = 0, firstFailure: string | null = null, maxPositionError = 0;
  let guideSampled = 0, guideMissed = 0, guideMaxOffsetError = 0, guideMinGap = Infinity, guideMaxGap = -Infinity;
  let guideFirstFailure: string | null = null;
  let boreSampled = 0, boreMissed = 0, boreMaxRadiusError = 0, boreMinGap = Infinity, boreMaxGap = -Infinity;
  let boreFirstFailure: string | null = null;
  let headSampled = 0, headMinGap = Infinity, headMaxGap = -Infinity, headFirstFailure: string | null = null;
  const halfAngle = task.contract.vHalfAngleDeg * Math.PI / 180;
  const centerOf = (parts: RenderedAssemblyPart[], id: string) => { const part = parts.find((p) => p.partId === id); if (!part) throw new Error(`missing ${id}`); const b = meshBounds(readBinaryStl(part.stl)); return [(b.min[0]+b.max[0])/2, (b.min[1]+b.max[1])/2, (b.min[2]+b.max[2])/2] as [number, number, number]; };
  for (const angle of task.angles) {
    let parts: RenderedAssemblyPart[];
    try { parts = angle === 0 ? zeroParts : await renderParts(angle); } catch (error) { return blocked(`The 18 instance meshes did not render at ${angle}°: ${error instanceof Error ? error.message : String(error)}`); }
    if (task.contract.instances) {
      for (let index = 0; index < task.selectors.sliders.length; index += 1) {
        const actual = centerOf(parts, task.selectors.sliders[index]);
        const expected = expectedInstanceCenter(task.contract, index, angle);
        measurements.sliderCenters.push({ angleDeg: angle, index, actual, expected });
        maxPositionError = Math.max(maxPositionError, Math.hypot(actual[0]-expected[0], actual[1]-expected[1], actual[2]-expected[2]));
      }
    } else {
      for (let station = 0; station < 4; station += 1) for (const side of [0, 1] as const) {
        const index = station * 2 + side;
        const actual = centerOf(parts, task.selectors.sliders[index]);
        const expected = expectedV8Center(task.contract, station, side, angle);
        measurements.sliderCenters.push({ angleDeg: angle, index, actual, expected });
        maxPositionError = Math.max(maxPositionError, Math.hypot(actual[0]-expected[0], actual[1]-expected[1], actual[2]-expected[2]));
      }
    }
    // Build each part's BVH once per angle and reuse it across all pairs. The
    // pair budget still decides the answer: exhausting it stays UNKNOWN.
    const placedBvhs = parts.map((part) => placeBvh(buildBvh(readBinaryStl(part.stl)), IDENTITY));
    for (let i = 0; i < parts.length; i += 1) for (let j = i+1; j < parts.length; j += 1) {
      collisionSampled += 1;
      const result = bvhIntersects(placedBvhs[i], placedBvhs[j], { maxPairTests: 4_000_000 });
      collisionTestedPairs += result.testedPairs;
      if (result.status === "SEPARATED") collisionSeparated += 1; else if (!firstFailure) firstFailure = `${angle}° ${parts[i].partId}/${parts[j].partId}:${result.status}`;
    }
    if (task.guide) {
      const frameMesh = readBinaryStl(parts.find((part) => part.partId === task.selectors.frame)!.stl);
      for (const side of [0, 1] as const) {
        const ux2 = side === 0 ? Math.sin(halfAngle) : -Math.sin(halfAngle);
        const uz2 = Math.cos(halfAngle);
        const px = Math.cos(halfAngle), pz = side === 0 ? -Math.sin(halfAngle) : Math.sin(halfAngle);
        for (let station = 0; station < 4; station += 1) {
          const index = station * 2 + side;
          const expected = expectedV8Center(task.contract, station, side, angle);
          const centerRadius = Math.hypot(expected[0], expected[2]);
          const sliderPart = parts.find((part) => part.partId === task.selectors.sliders[index])!;
          const sliderMesh = readBinaryStl(sliderPart.stl);
          const origin: [number, number, number] = [centerRadius * ux2, expected[1], centerRadius * uz2];
          for (const sign of [1, -1] as const) {
            const hit = nearestTriangleHit(frameMesh, origin, [sign * px, 0, sign * pz], 60);
            if (hit === null) {
              guideMissed += 1;
              guideFirstFailure ??= `No guide face was hit for slider ${index} at ${angle}° on the ${sign > 0 ? "positive" : "negative"} side.`;
              continue;
            }
            guideSampled += 1;
            const offsetError = Math.abs(hit - task.guide.offsetMm);
            guideMaxOffsetError = Math.max(guideMaxOffsetError, offsetError);
            let maxAlong = -Infinity;
            for (let vertex = 0; vertex < sliderMesh.triangleCount * 3; vertex += 1) {
              const base = vertex * 3;
              const along = sliderMesh.coordinates[base] * sign * px + sliderMesh.coordinates[base + 2] * sign * pz;
              if (along > maxAlong) maxAlong = along;
            }
            const gap = hit - maxAlong;
            guideMinGap = Math.min(guideMinGap, gap);
            guideMaxGap = Math.max(guideMaxGap, gap);
            if (guideFirstFailure === null && (offsetError > task.guide.toleranceMm || gap < task.guide.minGapMm || gap > task.guide.maxGapMm))
              guideFirstFailure = `Slider ${index} at ${angle}° side ${sign > 0 ? "+" : "-"}: guide face at ${hit.toFixed(3)} mm (declared ${task.guide.offsetMm}), gap ${gap.toFixed(3)} mm.`;
          }
        }
      }
    }
    if (task.contract.instances && (task.boreClearance || task.headClearance)) {
      const frameMesh = readBinaryStl(parts.find((part) => part.partId === task.selectors.frame)!.stl);
      for (let index = 0; index < task.selectors.sliders.length; index += 1) {
        const placement = task.contract.instances[index];
        const bank = placement.bankDeg * Math.PI / 180;
        const sx = Math.sin(bank), uz = Math.cos(bank);
        const expected = expectedInstanceCenter(task.contract, index, angle);
        const sliderMesh = readBinaryStl(parts.find((part) => part.partId === task.selectors.sliders[index])!.stl);
        if (task.boreClearance) {
          const stationRadial = Math.hypot(expected[0], expected[2]) + 2;
          const origin: [number, number, number] = [stationRadial * sx, expected[1], stationRadial * uz];
          const directions: Array<[number, number, number]> = [];
          for (const offsetDeg of [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]) {
            const radians = offsetDeg * Math.PI / 180;
            const inPlane = Math.cos(radians), alongY = Math.sin(radians);
            directions.push([inPlane * uz, alongY, -inPlane * sx]);
          }
          for (const direction of directions) {
            const hit = nearestTriangleHit(frameMesh, origin, direction, 20);
            if (hit === null) {
              boreMissed += 1;
              boreFirstFailure ??= `No bore wall was hit for slider ${index} at ${angle}°.`;
              continue;
            }
            boreSampled += 1;
            const radiusError = Math.abs(hit - task.boreClearance.innerRadiusMm);
            boreMaxRadiusError = Math.max(boreMaxRadiusError, radiusError);
            let sliderExtent = -Infinity;
            for (let vertex = 0; vertex < sliderMesh.triangleCount * 3; vertex += 1) {
              const base = vertex * 3;
              const along = sliderMesh.coordinates[base] * direction[0] + sliderMesh.coordinates[base + 1] * direction[1] + sliderMesh.coordinates[base + 2] * direction[2];
              const alongFromOrigin = along - (origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2]);
              if (alongFromOrigin > sliderExtent) sliderExtent = alongFromOrigin;
            }
            const gap = hit - sliderExtent;
            boreMinGap = Math.min(boreMinGap, gap);
            boreMaxGap = Math.max(boreMaxGap, gap);
            if (boreFirstFailure === null && (radiusError > task.boreClearance.radiusToleranceMm || gap < task.boreClearance.minGapMm || gap > task.boreClearance.maxGapMm))
              boreFirstFailure = `Slider ${index} at ${angle}°: bore wall at ${hit.toFixed(3)} mm (declared ${task.boreClearance.innerRadiusMm}), gap ${gap.toFixed(3)} mm.`;
          }
        }
        if (task.headClearance) {
          let sliderMaxAxial = -Infinity;
          for (let vertex = 0; vertex < sliderMesh.triangleCount * 3; vertex += 1) {
            const base = vertex * 3;
            const axial = sliderMesh.coordinates[base] * sx + sliderMesh.coordinates[base + 2] * uz;
            if (axial > sliderMaxAxial) sliderMaxAxial = axial;
          }
          let capMinAxial = Infinity;
          for (let vertex = 0; vertex < frameMesh.triangleCount * 3; vertex += 1) {
            const base = vertex * 3;
            const x = frameMesh.coordinates[base], y = frameMesh.coordinates[base + 1], z = frameMesh.coordinates[base + 2];
            if (Math.abs(y - placement.yMm) > 10) continue;
            const perp = Math.abs(x * uz - z * sx);
            if (perp > 14) continue;
            const axial = x * sx + z * uz;
            if (axial > sliderMaxAxial + 0.05 && axial < capMinAxial) capMinAxial = axial;
          }
          if (capMinAxial === Infinity) {
            headFirstFailure ??= `No cap or head-rail material was found beyond slider ${index} at ${angle}°.`;
            continue;
          }
          headSampled += 1;
          const gap = capMinAxial - sliderMaxAxial;
          headMinGap = Math.min(headMinGap, gap);
          headMaxGap = Math.max(headMaxGap, gap);
          // Only a too-close cap is a failure: a retracted piston legitimately has a
          // larger gap, and the scored value is the minimum sampled gap.
          if (headFirstFailure === null && gap < task.headClearance.minGapMm)
            headFirstFailure = `Slider ${index} at ${angle}°: head gap ${gap.toFixed(3)} mm is below the ${task.headClearance.minGapMm} mm minimum.`;
        }
      }
    }
  }
  measurements.maxPositionErrorMm = maxPositionError;
  measurements.collision = { sampled: collisionSampled, separated: collisionSeparated, testedPairs: collisionTestedPairs, firstFailure };
  measurements.boreClearance = task.boreClearance ? {
    status: boreMissed > 0 ? "NOT_RUN" : "PASS",
    reason: boreMissed > 0 ? (boreFirstFailure ?? "A bore ray missed the block.") : (boreFirstFailure ?? "Every sampled slider-to-bore radius and gap is inside the declared band."),
    sampled: boreSampled, missed: boreMissed,
    maxRadiusErrorMm: boreSampled > 0 ? boreMaxRadiusError : null,
    minGapMm: boreSampled > 0 ? boreMinGap : null,
    maxGapMm: boreSampled > 0 ? boreMaxGap : null,
  } : null;
  measurements.headClearance = task.headClearance ? {
    status: headSampled === 0 ? "NOT_RUN" : "PASS",
    reason: headSampled === 0 ? (headFirstFailure ?? "No head gap could be sampled.") : (headFirstFailure ?? "Every sampled piston-to-head gap is inside the declared band."),
    sampled: headSampled,
    minGapMm: headSampled > 0 ? headMinGap : null,
    maxGapMm: headSampled > 0 ? headMaxGap : null,
  } : null;
  measurements.guideClearance = task.guide ? {
    status: guideMissed > 0 ? "NOT_RUN" : "PASS",
    reason: guideMissed > 0 ? (guideFirstFailure ?? "A guide ray missed the block.") : (guideFirstFailure ?? "Every sampled slider-to-guide gap is inside the declared band."),
    sampled: guideSampled, missed: guideMissed,
    maxOffsetErrorMm: guideSampled > 0 ? guideMaxOffsetError : null,
    minGapMm: guideSampled > 0 ? guideMinGap : null,
    maxGapMm: guideSampled > 0 ? guideMaxGap : null,
  } : null;
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
  const boreMeasurement = measurements.boreClearance;
  const boreInBand = !!boreMeasurement && boreMeasurement.status === "PASS" && task.boreClearance !== undefined
    && boreMeasurement.maxRadiusErrorMm !== null && boreMeasurement.maxRadiusErrorMm <= task.boreClearance.radiusToleranceMm
    && boreMeasurement.minGapMm !== null && boreMeasurement.minGapMm >= task.boreClearance.minGapMm
    && boreMeasurement.maxGapMm !== null && boreMeasurement.maxGapMm <= task.boreClearance.maxGapMm;
  const boreObservation: Observation = boreMeasurement === null
    ? { id: "bore-clearance", status: "NOT_RUN", reason: "No boreClearance contract or missing frame/slider mesh prevented measurement." }
    : boreMeasurement.status === "NOT_RUN"
      ? { id: "bore-clearance", status: "NOT_RUN", reason: boreMeasurement.reason, artifactSha256, toolVersion, method: "Rays from each slider centre to the closed bore wall at the sampled crank angles.", coverage: `${boreMeasurement.sampled} bore wall sample(s), ${boreMeasurement.missed} missed.` }
      : { id: "bore-clearance", status: "MEASURED", value: boreInBand, artifactSha256, toolVersion,
          method: "Rays from each slider centre to the closed bore wall at the sampled crank angles.",
          coverage: `${boreMeasurement.sampled} samples; radius error limit ${task.boreClearance?.radiusToleranceMm} mm, gap band ${task.boreClearance?.minGapMm}-${task.boreClearance?.maxGapMm} mm.`,
          ...(boreInBand ? {} : { reason: boreMeasurement.reason }) };
  const headMeasurement = measurements.headClearance;
  const headInBand = !!headMeasurement && headMeasurement.status === "PASS" && task.headClearance !== undefined
    && headMeasurement.minGapMm !== null && headMeasurement.minGapMm >= task.headClearance.minGapMm
    && headMeasurement.minGapMm <= task.headClearance.maxGapMm;
  const headObservation: Observation = headMeasurement === null
    ? { id: "head-clearance", status: "NOT_RUN", reason: "No headClearance contract or missing frame/slider mesh prevented measurement." }
    : headMeasurement.status === "NOT_RUN"
      ? { id: "head-clearance", status: "NOT_RUN", reason: headMeasurement.reason, artifactSha256, toolVersion, method: "Minimum axial gap between each slider and the bore cap/head rail at the sampled angles.", coverage: `${headMeasurement.sampled} gap sample(s).` }
      : { id: "head-clearance", status: "MEASURED", value: headInBand, artifactSha256, toolVersion,
          method: "Minimum axial gap between each slider and the bore cap/head rail at the sampled angles.",
          coverage: `${headMeasurement.sampled} samples; gap band ${task.headClearance?.minGapMm}-${task.headClearance?.maxGapMm} mm; minimum ${headMeasurement.minGapMm?.toFixed(3)} mm.`,
          ...(headInBand ? {} : { reason: headMeasurement.reason }) };
  const guideMeasurement = measurements.guideClearance;
  const guideInBand = !!guideMeasurement && guideMeasurement.status === "PASS" && task.guide !== undefined
    && guideMeasurement.maxOffsetErrorMm !== null && guideMeasurement.maxOffsetErrorMm <= task.guide.toleranceMm
    && guideMeasurement.minGapMm !== null && guideMeasurement.minGapMm >= task.guide.minGapMm
    && guideMeasurement.maxGapMm !== null && guideMeasurement.maxGapMm <= task.guide.maxGapMm;
  const guideObservation: Observation = guideMeasurement === null
    ? { id: "guide-clearance", status: "NOT_RUN", reason: "No guide contract or a missing frame/slider mesh prevented measurement." }
    : guideMeasurement.status === "NOT_RUN"
      ? { id: "guide-clearance", status: "NOT_RUN", reason: guideMeasurement.reason, artifactSha256, toolVersion, method: "Rays from each slider centre to the nearest block face at the sampled crank angles.", coverage: `${guideMeasurement.sampled} guide face(s) sampled, ${guideMeasurement.missed} missed.` }
      : { id: "guide-clearance", status: "MEASURED", value: guideInBand, artifactSha256, toolVersion,
          method: "Rays from each slider centre to the nearest block face at the sampled crank angles.",
          coverage: `${guideMeasurement.sampled} guide face(s) at ${task.angles.length} angles; offset limit ${task.guide?.toleranceMm} mm, gap band ${task.guide?.minGapMm}-${task.guide?.maxGapMm} mm.`,
          ...(guideInBand ? {} : { reason: guideMeasurement.reason }) };
  const observations: Record<string, Observation> = {
    "bore-clearance": boreObservation,
    "head-clearance": headObservation,
    "guide-clearance": guideObservation,
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
