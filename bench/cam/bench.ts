import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { readBinaryStl } from "../../src/lib/geometry/stl-mesh";
import { buildBvh, placeBvh, bvhIntersects } from "../../src/lib/geometry/mesh-collision";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface CamTask {
  schemaVersion: 1; id: string; prompt: string;
  selectors: { frame: string; cam: string; follower: string };
  eccentricityMm: number; camRadiusMm: number; followerGapMm: number;
  angles: number[]; positionToleranceMm: number;
  contactGap?: { minMm: number; maxMm: number };
  requirements: BenchRequirement[]; notes?: string[];
}
export interface CamReport {
  schemaVersion: "cam-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: { parts: number; angles: Array<{ angleDeg: number; followerFaceMm: number; camMaxXMm: number; contactGapMm: number; expectedMm: number; errorMm: number; collisions: Array<{ pair: string; status: string }> }>; maxPositionErrorMm: number | null; contactGapMm: { minMm: number; maxMm: number } | null };
  provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function num(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
export function validateCamTask(value: unknown): CamTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object") fail("selectors must be an object");
  const s = raw.selectors as Record<string, unknown>;
  const selectors = { frame: String(s.frame), cam: String(s.cam), follower: String(s.follower) };
  if (Object.values(selectors).some((selector) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(selector)) || new Set(Object.values(selectors)).size !== 3) fail("selectors must be three distinct identifiers");
  const eccentricityMm = num(raw.eccentricityMm, "eccentricityMm"), camRadiusMm = num(raw.camRadiusMm, "camRadiusMm"), followerGapMm = num(raw.followerGapMm, "followerGapMm"), positionToleranceMm = num(raw.positionToleranceMm, "positionToleranceMm");
  if (!(eccentricityMm >= 0) || !(camRadiusMm > 0) || !(positionToleranceMm > 0) || Math.abs(followerGapMm) > 5) fail("cam dimensions or tolerance are invalid");
  let contactGap: { minMm: number; maxMm: number } | undefined;
  if (raw.contactGap !== undefined) {
    if (!raw.contactGap || typeof raw.contactGap !== "object") fail("contactGap must be an object");
    const g = raw.contactGap as Record<string, unknown>;
    const minMm = num(g.minMm, "contactGap.minMm");
    const maxMm = num(g.maxMm, "contactGap.maxMm");
    if (!(minMm >= 0) || !(maxMm > minMm) || !(maxMm < 2)) fail("contactGap bounds are invalid");
    contactGap = { minMm, maxMm };
  }
  if (!Array.isArray(raw.angles) || raw.angles.length < 4) fail("angles must have at least four entries");
  const angles = raw.angles.map((entry) => num(entry, "angles[]"));
  if (new Set(angles).size !== angles.length) fail("angles must be distinct");
  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("requirements must be non-empty");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`requirements[${index}] must be an object`);
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string" || !["distinct-exported-parts", "rigid-motion", "contact-gap"].includes(r.id)) fail(`requirements[${index}] has no cam observer`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(r.layer)) || typeof r.required !== "boolean" || typeof r.applicable !== "boolean") fail(`requirements[${index}] flags are invalid`);
    const e = r.expected as Record<string, unknown> | undefined;
    if (!e || e.kind !== "equals" || !["string", "boolean", "number"].includes(typeof e.value)) fail(`requirements[${index}].expected is invalid`);
    return { id: r.id, layer: r.layer as BenchRequirement["layer"], required: r.required, applicable: r.applicable, expected: { kind: "equals", value: e.value as string | boolean | number } };
  });
  if (requirements.some((r) => r.id === "contact-gap") && !contactGap) fail("a contact-gap requirement needs a contactGap contract");
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 3) fail("distinct-exported-parts must equal 3");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors, eccentricityMm, camRadiusMm, followerGapMm, angles, positionToleranceMm, ...(contactGap ? { contactGap } : {}), requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function camTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function camSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadCamTasks(root = camTasksDirectory()): Promise<CamTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort(); const tasks: CamTask[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validateCamTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no cam tasks under ${root}`);
  return tasks;
}
export async function loadCamSubmissions(taskId: string, root = camSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
function minX(stl: Buffer): number { const mesh = readBinaryStl(stl); let min = Infinity; for (let i = 0; i < mesh.coordinates.length; i += 3) min = Math.min(min, mesh.coordinates[i]); return min; }
function maxX(stl: Buffer): number { const mesh = readBinaryStl(stl); let max = -Infinity; for (let i = 0; i < mesh.coordinates.length; i += 3) max = Math.max(max, mesh.coordinates[i]); return max; }
function collisions(parts: Array<{ partId: string; stl: Buffer }>): Array<{ pair: string; status: string }> {
  const out: Array<{ pair: string; status: string }> = [];
  for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) {
    const result = bvhIntersects(placeBvh(buildBvh(readBinaryStl(parts[i].stl))), placeBvh(buildBvh(readBinaryStl(parts[j].stl))), { maxPairTests: 2_000_000 });
    out.push({ pair: `${parts[i].partId}/${parts[j].partId}`, status: result.status });
  }
  return out;
}

export async function scoreCamSubmission(task: CamTask, submission: Submission): Promise<CamReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = ["Only five sampled angles are covered; contact is a clearance gap, not spring-loaded contact, friction, load, wear or physical function.", "The follower is positioned by the source at each commanded angle; this is a source-driven pose check, not a dynamic simulation.", "Contact-gap is a bounding-box clearance along the motion axis at five sampled angles; it is not contact force, spring preload, friction, wear, surface finish or a calibrated tolerance."];
  const empty: CamReport["measurements"] = { parts: 0, angles: [], maxPositionErrorMm: null, contactGapMm: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: CamReport["measurements"]): CamReport => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "cam-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): CamReport => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  const angles: CamReport["measurements"]["angles"] = [];
  let distinctHashes = new Set<string>();
  for (const angleDeg of task.angles) {
    let parts: Awaited<ReturnType<typeof renderAssemblyParts>>;
    try { parts = await renderAssemblyParts({ scadSource: submission.source, parameters: { cam_angle: angleDeg }, parts: [{ partId: "frame", selector: task.selectors.frame }, { partId: "cam", selector: task.selectors.cam }, { partId: "follower", selector: task.selectors.follower }] }); }
    catch (error) { return blocked(`Angle ${angleDeg} did not render: ${error instanceof Error ? error.message : String(error)}`); }
    distinctHashes = new Set(parts.map((part) => part.sha256));
    const followerFaceMm = minX(parts.find((part) => part.partId === "follower")!.stl);
    const camMaxXMm = maxX(parts.find((part) => part.partId === "cam")!.stl);
    const contactGapMm = followerFaceMm - camMaxXMm;
    const expectedMm = task.camRadiusMm + task.eccentricityMm * Math.cos(angleDeg * Math.PI / 180) + task.followerGapMm;
    let collisionResults: Array<{ pair: string; status: string }>;
    try { collisionResults = collisions(parts); } catch (error) { return blocked(`Collision at ${angleDeg} failed: ${error instanceof Error ? error.message : String(error)}`); }
    angles.push({ angleDeg, followerFaceMm, camMaxXMm, contactGapMm, expectedMm, errorMm: Math.abs(followerFaceMm - expectedMm), collisions: collisionResults });
  }
  const maxError = Math.max(...angles.map((entry) => entry.errorMm));
  const allSeparated = angles.every((entry) => entry.collisions.every((collision) => collision.status === "SEPARATED"));
  const artifactSha256 = sha256(angles.map((entry) => `${entry.angleDeg}:${entry.followerFaceMm.toFixed(4)}`).join("|"));
  const toolVersion = `cam-bench/1 openscad:${openscadVersion()}`;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: "MEASURED", value: distinctHashes.size, artifactSha256, method: "Part hashes from the three cam selectors.", toolVersion, coverage: `${distinctHashes.size} distinct parts.`, ...(distinctHashes.size === 3 ? {} : { reason: `Only ${distinctHashes.size} distinct parts.` }) };
  const motionValues = angles.map((entry) => entry.errorMm);
  const motionPass = maxError <= task.positionToleranceMm && allSeparated;
  const motionObservation: Observation = { id: "rigid-motion", status: "MEASURED", value: motionPass, artifactSha256, method: "Follower face X from rendered bounds versus R + e*cos(theta) + gap, plus three pairwise mesh collisions.", toolVersion, coverage: `${angles.length} angles, ${angles[0].collisions.length} pairs per angle.`, ...(motionPass ? {} : { reason: `max position error ${maxError.toFixed(4)} mm (tolerance ${task.positionToleranceMm} mm); collisions ${allSeparated ? "separated" : "intersect"}: ${angles.flatMap((entry) => entry.collisions.filter((collision) => collision.status !== "SEPARATED").map((collision) => `${entry.angleDeg}° ${collision.pair}:${collision.status}`)).join(", ") || "position only"}` }) };
  const gapValues = angles.map((entry) => entry.contactGapMm);
  const gapMeasured = task.contactGap !== undefined && gapValues.length > 0;
  const gapPass = gapMeasured && gapValues.every((gap) => gap >= task.contactGap!.minMm && gap <= task.contactGap!.maxMm);
  const gapObservation: Observation = !gapMeasured
    ? { id: "contact-gap", status: "NOT_RUN", reason: "No contactGap contract declared for this task." }
    : { id: "contact-gap", status: "MEASURED", value: gapPass, artifactSha256, toolVersion,
        method: "Follower face minimum X minus cam maximum X from rendered bounds at every sampled angle.",
        coverage: `${angles.length} angles; gap ${Math.min(...gapValues).toFixed(3)}-${Math.max(...gapValues).toFixed(3)} mm; band ${task.contactGap!.minMm}-${task.contactGap!.maxMm} mm.`,
        ...(gapPass ? {} : { reason: `The sampled cam/follower gap ${Math.min(...gapValues).toFixed(3)}-${Math.max(...gapValues).toFixed(3)} mm is outside the declared ${task.contactGap!.minMm}-${task.contactGap!.maxMm} mm band.` }) };
  const observations: Record<string, Observation> = { "distinct-exported-parts": distinctObservation, "rigid-motion": motionObservation, "contact-gap": gapObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  const contactGapMm = task.contactGap ? { minMm: Math.min(...angles.map((entry) => entry.contactGapMm)), maxMm: Math.max(...angles.map((entry) => entry.contactGapMm)) } : null;
  return baseReport(aggregateStatus(results), results, { parts: 3, angles, maxPositionErrorMm: maxError, contactGapMm });
}
