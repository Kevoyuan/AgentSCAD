/**
 * Epicyclic gear-train bench: fixed internal ring, sun input and carrier output,
 * with one planet measured through the carrier. It reuses the product's
 * gear-profile and planetary-coupling measurement tools on the actual fixture.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { measureGearMarkerAngle, measureGearProfile, checkPlanetaryCoupling, type GearProfileMeasurement, type PlanetaryPose } from "../../src/lib/assembly/gear-marker";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface PlanetarySelectors { sun: string; planet: string; ring: string; carrier: string }
export interface PlanetaryBenchTask {
  schemaVersion: 1; id: string; prompt: string; selectors: PlanetarySelectors;
  sunTeeth: number; planetTeeth: number; ringTeeth: number; moduleMm: number; carrierRadiusMm: number;
  poses: number[]; angleToleranceDeg: number; ratioTolerance: number; centerDistanceToleranceMm: number;
  requirements: BenchRequirement[]; notes?: string[];
}
export interface PlanetaryMeasurements {
  parts: Array<{ id: string; triangleCount: number }>;
  profiles: { sun: unknown; planet: unknown; ring: unknown } | null;
  poses: PlanetaryPose[];
  coupling: ReturnType<typeof checkPlanetaryCoupling> | null;
  maxCarrierResidualDeg: number | null;
  maxSunResidualDeg: number | null;
  maxPlanetResidualDeg: number | null;
}
export interface PlanetaryCaseReport {
  schemaVersion: "planetary-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: PlanetaryMeasurements; provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const wrap180 = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
function identifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(`${field} must be an identifier`); return value; }
function integer(value: unknown, field: string): number { const v = finite(value, field); if (!Number.isInteger(v) || v <= 0) fail(`${field} must be a positive integer`); return v; }

export function validatePlanetaryTask(value: unknown): PlanetaryBenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const roles = ["sun", "planet", "ring", "carrier"] as const;
  if (Object.keys(s).sort().join(",") !== [...roles].sort().join(",")) fail("selectors must name exactly sun, planet, ring and carrier");
  const selectors = Object.fromEntries(roles.map((role) => [role, identifier(s[role], `selectors.${role}`)])) as unknown as PlanetarySelectors;
  if (new Set(Object.values(selectors)).size !== 4) fail("selectors must be distinct");
  const sunTeeth = integer(raw.sunTeeth, "sunTeeth"), planetTeeth = integer(raw.planetTeeth, "planetTeeth"), ringTeeth = integer(raw.ringTeeth, "ringTeeth");
  if (ringTeeth !== sunTeeth + 2 * planetTeeth) fail("ringTeeth must equal sunTeeth + 2*planetTeeth");
  const moduleMm = finite(raw.moduleMm, "moduleMm");
  if (!(moduleMm > 0)) fail("moduleMm must be positive");
  const carrierRadiusMm = finite(raw.carrierRadiusMm, "carrierRadiusMm");
  if (!(carrierRadiusMm > 0)) fail("carrierRadiusMm must be positive");
  if (!Array.isArray(raw.poses) || raw.poses.length < 4) fail("poses must have at least four entries");
  const poses = raw.poses.map((entry) => finite(entry, "poses[]"));
  if (new Set(poses).size !== poses.length) fail("poses must be distinct");
  if (!poses.some((pose) => pose > 0) || !poses.some((pose) => pose < 0)) fail("poses must cover positive and negative input");
  const angleToleranceDeg = finite(raw.angleToleranceDeg, "angleToleranceDeg"), ratioTolerance = finite(raw.ratioTolerance, "ratioTolerance"), centerDistanceToleranceMm = finite(raw.centerDistanceToleranceMm, "centerDistanceToleranceMm");
  if (!(angleToleranceDeg > 0) || !(ratioTolerance > 0) || !(centerDistanceToleranceMm > 0)) fail("tolerances must be positive");
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
  const observable = new Set(["distinct-exported-parts", "rigid-motion"]);
  for (const r of requirements) if (!observable.has(r.id)) fail(`requirement ${r.id} has no observer`);
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 4) fail("distinct-exported-parts must equal 4");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors, sunTeeth, planetTeeth, ringTeeth, moduleMm, carrierRadiusMm, poses, angleToleranceDeg, ratioTolerance, centerDistanceToleranceMm, requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function planetaryTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function planetarySubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadPlanetaryTasks(root = planetaryTasksDirectory()): Promise<PlanetaryBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort(); const tasks: PlanetaryBenchTask[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validatePlanetaryTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no planetary tasks under ${root}`);
  return tasks;
}
export async function loadPlanetarySubmissions(taskId: string, root = planetarySubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
const summary = (profile: GearProfileMeasurement) => ({ status: profile.status, centerMm: profile.centerMm, toothCount: profile.toothCount, pitchRadiusMm: profile.pitchRadiusMm, markerAngleDeg: profile.marker?.angleDeg ?? null, reason: profile.reason });

export async function scorePlanetarySubmission(task: PlanetaryBenchTask, submission: Submission): Promise<PlanetaryCaseReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = [
    "A PASS covers the listed five input poses and rendered markers; it is not tooth contact, backlash, load, efficiency, wear or physical manufacture.",
    "Pitch radius is estimated from measured tip/root radii of straight-sided teeth, not involute metrology.",
    "The fixture's radial tabs and bores are measurement features, not a claim about arbitrary generated part identity.",
  ];
  const empty: PlanetaryMeasurements = { parts: [], profiles: null, poses: [], coupling: null, maxCarrierResidualDeg: null, maxSunResidualDeg: null, maxPlanetResidualDeg: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: PlanetaryMeasurements): PlanetaryCaseReport => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "planetary-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): PlanetaryCaseReport => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  let parts: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try { parts = await renderAssemblyParts({ scadSource: submission.source, parameters: { input_deg: 0 }, parts: Object.entries(task.selectors).map(([id, selector]) => ({ partId: id, selector })) }); }
  catch (error) { return blocked(`The four gear parts did not render: ${error instanceof Error ? error.message : String(error)}`); }
  const measurements: PlanetaryMeasurements = { ...empty, parts: parts.map((part) => ({ id: part.partId, triangleCount: part.triangleCount })) };
  const ring = measureGearProfile({ stl: parts.find((part) => part.partId === "ring")!.stl, mode: "internal", center: [0, 0], measureAxis: false });
  if (ring.status !== "MEASURED") return blocked(`Ring profile was not measured: ${ring.reason}`);
  let carrierPhase: number | null = null; let sun: GearProfileMeasurement | null = null; let planet: GearProfileMeasurement | null = null;
  let sunReference: GearProfileMeasurement | null = null; let planetReference: GearProfileMeasurement | null = null;
  const poses: PlanetaryPose[] = [];
  for (const inputDeg of task.poses) {
    let poseParts: Awaited<ReturnType<typeof renderAssemblyParts>>;
    try { poseParts = await renderAssemblyParts({ scadSource: submission.source, parameters: { input_deg: inputDeg }, parts: [{ partId: "sun", selector: task.selectors.sun }, { partId: "planet", selector: task.selectors.planet }, { partId: "carrier", selector: task.selectors.carrier }] }); }
    catch (error) { return blocked(`Pose ${inputDeg} did not render: ${error instanceof Error ? error.message : String(error)}`); }
    const stl = (partId: string) => poseParts.find((part) => part.partId === partId)!.stl;
    const carrierMarker = measureGearMarkerAngle({ stl: stl("carrier"), center: [0, 0], minRadiusMm: 9.5, maxRadiusMm: 12.6 });
    if (carrierMarker.status !== "MEASURED" || carrierMarker.angleDeg === null) return blocked(`Carrier marker at ${inputDeg} was not measured: ${carrierMarker.reason}`);
    if (inputDeg === 0) carrierPhase = carrierMarker.angleDeg;
    if (carrierPhase === null) return blocked("The zero-input pose must come first in task.poses.");
    const carrierAngleDeg = wrap180(carrierMarker.angleDeg - carrierPhase);
    const seed: [number, number] = [task.carrierRadiusMm * Math.cos(carrierAngleDeg * Math.PI / 180), task.carrierRadiusMm * Math.sin(carrierAngleDeg * Math.PI / 180)];
    sun = measureGearProfile({ stl: stl("sun"), mode: "external", center: [0, 0] });
    planet = measureGearProfile({ stl: stl("planet"), mode: "external", center: seed });
    if (sun.status !== "MEASURED" || planet.status !== "MEASURED" || !sun.marker || !planet.marker) return blocked(`Sun/planet at ${inputDeg} were not measured: ${sun.reason} / ${planet.reason}`);
    if (inputDeg === 0) { sunReference = sun; planetReference = planet; }
    poses.push({ inputDeg, sunAngleDeg: sun.marker.angleDeg, carrierAngleDeg, planetAngleDeg: planet.marker.angleDeg, planetCenterMm: planet.centerMm! });
  }
  if (!sunReference || !planetReference) return blocked("No zero-input reference profile.");
  const coupling = checkPlanetaryCoupling({ poses, sun: sunReference, planet: planetReference, ring, angleToleranceDeg: task.angleToleranceDeg, ratioTolerance: task.ratioTolerance, centerDistanceToleranceMm: task.centerDistanceToleranceMm });
  measurements.profiles = { sun: summary(sunReference), planet: summary(planetReference), ring: summary(ring) };
  measurements.poses = poses;
  measurements.coupling = coupling;
  measurements.maxCarrierResidualDeg = coupling.carrierResidualMaxDeg;
  measurements.maxSunResidualDeg = coupling.sunResidualMaxDeg;
  measurements.maxPlanetResidualDeg = coupling.planetResidualMaxDeg;
  const toolVersion = `planetary-bench/1 openscad:${openscadVersion()}`;
  const artifactSha256 = sha256(parts.map((part) => part.sha256).join(":"));
  const measuredDistinct = new Set(parts.map((part) => part.sha256)).size;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: "MEASURED", value: measuredDistinct, artifactSha256, method: "Part hashes from four rendered selectors (sun, planet, ring, carrier).", toolVersion, coverage: "4 selectors.", ...(measuredDistinct === 4 ? {} : { reason: `Only ${measuredDistinct} distinct parts.` }) };
  const motionObservation: Observation = { id: "rigid-motion", status: coupling.status === "PASS" ? "MEASURED" : coupling.status === "FAIL" ? "MEASURED" : "NOT_RUN", ...(coupling.status === "PASS" || coupling.status === "FAIL" ? { value: coupling.status === "PASS" } : {}), artifactSha256, method: "Sun/planet/ring tooth counts and pitch radii, carrier/sun/planet marker slopes, reversal coverage and ring pitch closure.", toolVersion, coverage: `${poses.length} poses; ring ${ring.toothCount} teeth.`, ...(coupling.status === "PASS" ? {} : { reason: coupling.reason }) };
  const observations: Record<string, Observation> = { "distinct-exported-parts": distinctObservation, "rigid-motion": motionObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
