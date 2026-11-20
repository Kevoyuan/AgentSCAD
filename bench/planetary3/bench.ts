/**
 * Multi-planet epicyclic bench: fixed internal ring, sun input, carrier output,
 * three planets at 120 degrees. Each planet is measured independently.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { checkPlanetaryCoupling, measureGearMarkerAngle, measureGearProfile, type GearProfileMeasurement, type PlanetaryPose } from "../../src/lib/assembly/gear-marker";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface Planetary3Selectors { sun: string; ring: string; carrier: string; planets: string[] }
export interface Planetary3Task {
  schemaVersion: 1; id: string; prompt: string; selectors: Planetary3Selectors; planetOffsetsDeg: number[];
  sunTeeth: number; planetTeeth: number; ringTeeth: number; moduleMm: number; carrierRadiusMm: number;
  poses: number[]; angleToleranceDeg: number; ratioTolerance: number; centerDistanceToleranceMm: number; requirements: BenchRequirement[]; notes?: string[];
}
export interface Planetary3Measurements {
  parts: Array<{ id: string; triangleCount: number }>;
  planets: Array<{ id: string; profile: unknown; poses: PlanetaryPose[]; coupling: ReturnType<typeof checkPlanetaryCoupling> | null }>;
  maxCarrierResidualDeg: number | null; maxPlanetResidualDeg: number | null;
}
export interface Planetary3Report {
  schemaVersion: "planetary3-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: Planetary3Measurements; provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const wrap180 = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
function identifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(`${field} must be an identifier`); return value; }
function integer(value: unknown, field: string): number { const v = finite(value, field); if (!Number.isInteger(v) || v <= 0) fail(`${field} must be a positive integer`); return v; }

export function validatePlanetary3Task(value: unknown): Planetary3Task {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const sun = identifier(s.sun, "selectors.sun"), ring = identifier(s.ring, "selectors.ring"), carrier = identifier(s.carrier, "selectors.carrier");
  if (!Array.isArray(s.planets) || s.planets.length !== 3) fail("selectors.planets must have 3 selectors");
  const planets = s.planets.map((entry, index) => identifier(entry, `selectors.planets[${index}]`));
  if (new Set([sun, ring, carrier, ...planets]).size !== 6) fail("selectors must be 6 distinct identifiers");
  if (!Array.isArray(raw.planetOffsetsDeg) || raw.planetOffsetsDeg.length !== 3) fail("planetOffsetsDeg must have 3 entries");
  const planetOffsetsDeg = raw.planetOffsetsDeg.map((entry) => finite(entry, "planetOffsetsDeg[]"));
  if (new Set(planetOffsetsDeg).size !== 3) fail("planetOffsetsDeg must be distinct");
  const sunTeeth = integer(raw.sunTeeth, "sunTeeth"), planetTeeth = integer(raw.planetTeeth, "planetTeeth"), ringTeeth = integer(raw.ringTeeth, "ringTeeth");
  if (ringTeeth !== sunTeeth + 2 * planetTeeth) fail("ringTeeth must equal sunTeeth + 2*planetTeeth");
  const moduleMm = finite(raw.moduleMm, "moduleMm"), carrierRadiusMm = finite(raw.carrierRadiusMm, "carrierRadiusMm");
  if (!(moduleMm > 0) || !(carrierRadiusMm > 0)) fail("module and carrier radius must be positive");
  if (!Array.isArray(raw.poses) || raw.poses.length < 4) fail("poses must have at least four entries");
  const poses = raw.poses.map((entry) => finite(entry, "poses[]"));
  if (new Set(poses).size !== poses.length || !poses.some((p) => p > 0) || !poses.some((p) => p < 0)) fail("poses must be distinct and cover both signs");
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
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 6) fail("distinct-exported-parts must equal 6");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors: { sun, ring, carrier, planets }, planetOffsetsDeg, sunTeeth, planetTeeth, ringTeeth, moduleMm, carrierRadiusMm, poses, angleToleranceDeg, ratioTolerance, centerDistanceToleranceMm, requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function planetary3TasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function planetary3SubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadPlanetary3Tasks(root = planetary3TasksDirectory()): Promise<Planetary3Task[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort(); const tasks: Planetary3Task[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validatePlanetary3Task(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no planetary3 tasks under ${root}`);
  return tasks;
}
export async function loadPlanetary3Submissions(taskId: string, root = planetary3SubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
const summary = (profile: GearProfileMeasurement) => ({ status: profile.status, centerMm: profile.centerMm, toothCount: profile.toothCount, pitchRadiusMm: profile.pitchRadiusMm, markerAngleDeg: profile.marker?.angleDeg ?? null, reason: profile.reason });

export async function scorePlanetary3Submission(task: Planetary3Task, submission: Submission): Promise<Planetary3Report> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = ["A PASS covers five input poses and three independently measured planets; it is not multi-planet load sharing, tooth contact, backlash, efficiency or physical manufacture.", "Pitch radius is estimated from straight-sided tooth tip/root radii, not involute metrology.", "One carrier and one ring are modeled; the fixture does not prove a manufactured gearbox."];
  const empty: Planetary3Measurements = { parts: [], planets: [], maxCarrierResidualDeg: null, maxPlanetResidualDeg: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: Planetary3Measurements): Planetary3Report => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "planetary3-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): Planetary3Report => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  const partIds = ["sun", "ring", "carrier", ...task.selectors.planets];
  let staticParts: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try { staticParts = await renderAssemblyParts({ scadSource: submission.source, parameters: { input_deg: 0 }, parts: [{ partId: "sun", selector: task.selectors.sun }, { partId: "ring", selector: task.selectors.ring }, { partId: "carrier", selector: task.selectors.carrier }, ...task.selectors.planets.map((selector, index) => ({ partId: `planet${index}`, selector }))] }); }
  catch (error) { return blocked(`The six gear parts did not render: ${error instanceof Error ? error.message : String(error)}`); }
  const measurements: Planetary3Measurements = { ...empty, parts: staticParts.map((part) => ({ id: part.partId, triangleCount: part.triangleCount })) };
  const ring = measureGearProfile({ stl: staticParts.find((part) => part.partId === "ring")!.stl, mode: "internal", center: [0, 0], measureAxis: false });
  if (ring.status !== "MEASURED") return blocked(`Ring profile not measured: ${ring.reason}`);
  let carrierPhase: number | null = null; let sunReference: GearProfileMeasurement | null = null;
  const planetReferences: Array<GearProfileMeasurement | null> = task.selectors.planets.map(() => null);
  const posesByPlanet: PlanetaryPose[][] = task.selectors.planets.map(() => []);
  for (const inputDeg of task.poses) {
    let parts: Awaited<ReturnType<typeof renderAssemblyParts>>;
    try { parts = await renderAssemblyParts({ scadSource: submission.source, parameters: { input_deg: inputDeg }, parts: [{ partId: "sun", selector: task.selectors.sun }, { partId: "carrier", selector: task.selectors.carrier }, ...task.selectors.planets.map((selector, index) => ({ partId: `planet${index}`, selector }))] }); }
    catch (error) { return blocked(`Pose ${inputDeg} did not render: ${error instanceof Error ? error.message : String(error)}`); }
    const stl = (id: string) => parts.find((part) => part.partId === id)!.stl;
    const cm = measureGearMarkerAngle({ stl: stl("carrier"), center: [0, 0], minRadiusMm: 9.5, maxRadiusMm: 12.6 });
    if (cm.status !== "MEASURED" || cm.angleDeg === null) return blocked(`Carrier marker at ${inputDeg} not measured: ${cm.reason}`);
    if (inputDeg === 0) carrierPhase = cm.angleDeg;
    if (carrierPhase === null) return blocked("Zero-input pose must come first.");
    const carrierAngleDeg = wrap180(cm.angleDeg - carrierPhase);
    const sun = measureGearProfile({ stl: stl("sun"), mode: "external", center: [0, 0] });
    if (inputDeg === 0) sunReference = sun;
    if (sun.status !== "MEASURED" || !sun.marker) return blocked(`Sun at ${inputDeg} not measured: ${sun.reason}`);
    for (let index = 0; index < task.selectors.planets.length; index += 1) {
      const a = carrierAngleDeg + task.planetOffsetsDeg[index];
      const seed: [number, number] = [task.carrierRadiusMm * Math.cos(a * Math.PI / 180), task.carrierRadiusMm * Math.sin(a * Math.PI / 180)];
      const planet = measureGearProfile({ stl: stl(`planet${index}`), mode: "external", center: seed });
      if (planet.status !== "MEASURED" || !planet.marker) return blocked(`Planet ${index} at ${inputDeg} not measured: ${planet.reason}`);
      if (inputDeg === 0) planetReferences[index] = planet;
      posesByPlanet[index].push({ inputDeg, sunAngleDeg: sun.marker.angleDeg, carrierAngleDeg, planetAngleDeg: planet.marker.angleDeg, planetCenterMm: planet.centerMm! });
    }
  }
  if (!sunReference) return blocked("No zero-input sun reference.");
  const planets: Planetary3Measurements["planets"] = [];
  for (let index = 0; index < task.selectors.planets.length; index += 1) {
    const reference = planetReferences[index];
    if (!reference) return blocked(`No zero-input profile for planet ${index}.`);
    const coupling = checkPlanetaryCoupling({ poses: posesByPlanet[index], sun: sunReference, planet: reference, ring, angleToleranceDeg: task.angleToleranceDeg, ratioTolerance: task.ratioTolerance, centerDistanceToleranceMm: task.centerDistanceToleranceMm });
    planets.push({ id: task.selectors.planets[index], profile: summary(reference), poses: posesByPlanet[index], coupling });
    measurements.maxCarrierResidualDeg = Math.max(measurements.maxCarrierResidualDeg ?? 0, coupling.carrierResidualMaxDeg ?? 0);
    measurements.maxPlanetResidualDeg = Math.max(measurements.maxPlanetResidualDeg ?? 0, coupling.planetResidualMaxDeg ?? 0);
  }
  measurements.planets = planets;
  const allPass = planets.every((planet) => planet.coupling?.status === "PASS");
  const anyFail = planets.some((planet) => planet.coupling?.status === "FAIL");
  const anyMissing = planets.some((planet) => planet.coupling?.status !== "PASS" && planet.coupling?.status !== "FAIL");
  const toolVersion = `planetary3-bench/1 openscad:${openscadVersion()}`;
  const artifactSha256 = sha256(staticParts.map((part) => part.sha256).join(":"));
  const distinct = new Set(staticParts.map((part) => part.sha256)).size;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256, method: "Part hashes from six rendered selectors (sun, ring, carrier, three planets).", toolVersion, coverage: "6 selectors.", ...(distinct === 6 ? {} : { reason: `Only ${distinct} distinct parts.` }) };
  const motionStatus: Observation["status"] = allPass ? "MEASURED" : anyFail ? "MEASURED" : anyMissing ? "NOT_RUN" : "ERROR";
  const motionObservation: Observation = { id: "rigid-motion", status: motionStatus, ...(motionStatus === "MEASURED" ? { value: allPass } : {}), artifactSha256, method: "Independent sun/planet/ring profiles and marker slopes for each of three planets.", toolVersion, coverage: `${planets.length} planets x ${task.poses.length} poses.`, ...(allPass ? {} : { reason: planets.map((planet) => `${planet.id}: ${planet.coupling?.status ?? "NOT_RUN"} ${planet.coupling?.reason ?? ""}`).join(" | ") }) };
  const observations: Record<string, Observation> = { "distinct-exported-parts": distinctObservation, "rigid-motion": motionObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
