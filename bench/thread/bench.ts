/**
 * Threaded-fastener bench: square-profile helical geometry and measured lead.
 * Geometry and engagement/advance are scored independently; the tool's optional
 * exit/coaxiality layers are outside this task.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { meshBounds, readBinaryStl, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { sampleThreadedFastener } from "../../src/lib/tools/thread-measurement";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import { scoreEvidence } from "../layers";
import { aggregateStatus, expectedOutcome, type BenchRequirement, type EvidenceStatus, type ExpectedOutcome, type Submission } from "../assembly/bench";

export interface ThreadTask {
  schemaVersion: 1; id: string; prompt: string;
  selectors: { bolt: string; nut: string };
  geometry: Parameters<typeof sampleThreadedFastener>[0]["geometry"];
  motion: Parameters<typeof sampleThreadedFastener>[0]["motion"];
  turns: number[]; poseParameters?: Record<string, number | string | boolean>;
  exit?: Parameters<typeof sampleThreadedFastener>[0]["exit"];
  coaxiality?: { toleranceMm: number };
  requirements: BenchRequirement[]; notes?: string[];
}
export interface ThreadMeasurements {
  parts: number;
  exit: string | null;
  external: { status: string | null; pitchMm: number | null; hand: string | null; majorDiameterMm: number | null; minorDiameterMm: number | null };
  internal: { status: string | null; pitchMm: number | null; hand: string | null; majorDiameterMm: number | null; minorDiameterMm: number | null };
  engagement: string | null; motion: string | null;
  leadPerTurnMm: number | null; advanceResidualMm: number | null; turnsCovered: number | null;
  coaxiality: { status: string; reason: string; boltOffsetMm: number | null; nutOffsetMm: number | null; toleranceMm: number } | null;
}
export interface ThreadReport {
  schemaVersion: "thread-bench.case.v1"; taskId: string; submission: string; expected: ExpectedOutcome;
  sourcePath: string; sourceSha256: string; status: EvidenceStatus; gatePassed: boolean; results: Result[];
  layers: { coverage: { passed: number; observed: number; ratio: number | null; unobserved: string[] }; byLayer: Array<{ layer: string; status: string | null; blockers: string[] }> };
  measurements: ThreadMeasurements; provenance: { createdAt: string; backend: string; openscad: string; runtime: string; platform: string }; unknowns: string[];
}
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fail(message: string): never { throw new Error(message); }
function finite(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
export function validateThreadTask(value: unknown): ThreadTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("id is invalid");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("prompt must be non-trivial");
  if (!raw.selectors || typeof raw.selectors !== "object" || Object.keys(raw.selectors as object).sort().join(",") !== "bolt,nut") fail("selectors must name bolt and nut");
  const s = raw.selectors as Record<string, unknown>;
  const bolt = String(s.bolt), nut = String(s.nut);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(bolt) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(nut) || bolt === nut) fail("bolt and nut selectors must be distinct");
  if (!raw.geometry || typeof raw.geometry !== "object" || !raw.motion || typeof raw.motion !== "object") fail("geometry and motion are required");
  if (!Array.isArray(raw.turns) || raw.turns.length < 3 || raw.turns.length > 64) fail("turns must have 3 to 64 entries");
  const turns = raw.turns.map((entry) => finite(entry, "turns[]"));
  if (new Set(turns).size !== turns.length) fail("turns must be unique");
  let coaxiality: { toleranceMm: number } | undefined;
  if (raw.coaxiality !== undefined) {
    if (!raw.coaxiality || typeof raw.coaxiality !== "object") fail("coaxiality must be an object");
    const toleranceMm = finite((raw.coaxiality as Record<string, unknown>).toleranceMm, "coaxiality.toleranceMm");
    if (!(toleranceMm > 0)) fail("coaxiality.toleranceMm must be positive");
    coaxiality = { toleranceMm };
  }
  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("requirements must be non-empty");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`requirements[${index}] must be an object`);
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string" || !["distinct-exported-parts", "measured-joint-frames", "rigid-motion", "disassembly-path", "thread-coaxiality"].includes(r.id)) fail(`requirements[${index}] has no thread observer`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(r.layer)) || typeof r.required !== "boolean" || typeof r.applicable !== "boolean") fail(`requirements[${index}] flags are invalid`);
    const e = r.expected as Record<string, unknown> | undefined;
    if (!e || e.kind !== "equals" || !["string", "boolean", "number"].includes(typeof e.value)) fail(`requirements[${index}].expected is invalid`);
    return { id: r.id, layer: r.layer as BenchRequirement["layer"], required: r.required, applicable: r.applicable, expected: { kind: "equals", value: e.value as string | boolean | number } };
  });
  if (requirements.some((r) => r.id === "thread-coaxiality") && !coaxiality) fail("a thread-coaxiality requirement needs a coaxiality contract");
  const distinct = requirements.find((r) => r.id === "distinct-exported-parts");
  if (!distinct || distinct.expected.kind !== "equals" || distinct.expected.value !== 2) fail("distinct-exported-parts must equal 2");
  return { schemaVersion: 1, id: raw.id, prompt: raw.prompt, selectors: { bolt, nut }, geometry: raw.geometry as ThreadTask["geometry"], motion: raw.motion as ThreadTask["motion"], turns, ...(raw.poseParameters && typeof raw.poseParameters === "object" ? { poseParameters: raw.poseParameters as Record<string, number | string | boolean> } : {}), ...(raw.exit && typeof raw.exit === "object" ? { exit: raw.exit as ThreadTask["exit"] } : {}), ...(coaxiality ? { coaxiality } : {}), requirements, ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}) };
}
export function threadTasksDirectory(): string { return path.join(import.meta.dir, "tasks"); }
export function threadSubmissionsDirectory(): string { return path.join(import.meta.dir, "submissions"); }
export async function loadThreadTasks(root = threadTasksDirectory()): Promise<ThreadTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort(); const tasks: ThreadTask[] = [];
  for (const name of names) { const raw = JSON.parse(await readFile(path.join(root, name), "utf8")); try { tasks.push(validateThreadTask(raw)); } catch (error) { fail(`${name}: ${error instanceof Error ? error.message : String(error)}`); } }
  if (tasks.length === 0) fail(`no thread tasks under ${root}`);
  return tasks;
}
export async function loadThreadSubmissions(taskId: string, root = threadSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId); let names: string[];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort(); } catch { return []; }
  return Promise.all(names.map(async (name) => { const sourcePath = path.join(directory, name); return { taskId, id: name.replace(/\.scad$/, ""), sourcePath, source: await readFile(sourcePath, "utf8") }; }));
}
let cachedOpenscadVersion: string | null = null;
function openscadVersion(): string { if (cachedOpenscadVersion !== null) return cachedOpenscadVersion; const r = Bun.spawnSync(["openscad", "--version"], { stdout: "pipe", stderr: "pipe" }); cachedOpenscadVersion = r.success ? r.stdout.toString().trim() : "unavailable"; return cachedOpenscadVersion; }
function statusOf(value: unknown): string | null { return value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string" ? (value as { status: string }).status : null; }
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function crossSectionCenter(mesh: TriangleMesh, accept: (x: number, y: number, z: number) => boolean): { x: number; y: number; n: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) for (let corner = 0; corner < 3; corner += 1) {
    const base = triangle * 9 + corner * 3;
    const x = mesh.coordinates[base], y = mesh.coordinates[base + 1], z = mesh.coordinates[base + 2];
    if (!accept(x, y, z)) continue;
    n += 1; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return n < 12 ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2, n };
}

/**
 * Measured thread-to-body coaxiality: within a two-pitch band of the threaded
 * section the full helix covers a whole turn, so the lateral bounding-box centre
 * of that band is the thread axis; the body axis comes from the bolt head or the
 * nut outside the thread band. This is sampled line-of-sight geometry, not a
 * calibrated metrology measurement.
 */
function measureThreadCoaxiality(task: ThreadTask, rendered: Awaited<ReturnType<typeof renderAssemblyParts>>): ThreadMeasurements["coaxiality"] {
  if (!task.coaxiality) return null;
  const boltRendered = rendered.find((part) => part.partId === task.selectors.bolt);
  const nutRendered = rendered.find((part) => part.partId === task.selectors.nut);
  if (!boltRendered || !nutRendered) return { status: "NOT_RUN", reason: "A thread part selector rendered no mesh.", boltOffsetMm: null, nutOffsetMm: null, toleranceMm: task.coaxiality.toleranceMm };
  const bolt = readBinaryStl(boltRendered.stl);
  const nut = readBinaryStl(nutRendered.stl);
  const pitch = task.geometry.external.pitchMm;
  const bandMm = Math.min(2 * pitch, task.geometry.external.threadRangeMm.max - task.geometry.external.threadRangeMm.min);
  const boltStart = task.geometry.external.threadRangeMm.min + 0.5;
  const boltCenter = crossSectionCenter(bolt, (x, y, z) => z >= boltStart && z <= boltStart + bandMm && Math.hypot(x, y) <= task.geometry.external.majorDiameterMm.max / 2 + 0.6);
  const boltBody = crossSectionCenter(bolt, (_x, _y, z) => z <= task.geometry.external.threadRangeMm.min - 0.5);
  const nutBounds = meshBounds(nut);
  const nutBandStart = nutBounds.min[2] + 0.3;
  const nutBandEnd = Math.min(nutBounds.max[2] - 0.3, nutBandStart + bandMm);
  const nutCenter = crossSectionCenter(nut, (x, y, z) => z >= nutBandStart && z <= nutBandEnd && Math.hypot(x, y) <= task.geometry.internal.majorDiameterMm.max / 2 + 0.6);
  const nutBody = crossSectionCenter(nut, (x, y, z) => z >= nutBounds.min[2] && z <= nutBounds.max[2] && Math.hypot(x, y) > task.geometry.internal.majorDiameterMm.max / 2 + 2);
  if (!boltCenter || !boltBody || !nutCenter || !nutBody) return { status: "NOT_RUN", reason: "The thread or body reference section could not be sampled for coaxiality.", boltOffsetMm: null, nutOffsetMm: null, toleranceMm: task.coaxiality.toleranceMm };
  const boltOffsetMm = Math.hypot(boltCenter.x - boltBody.x, boltCenter.y - boltBody.y);
  const nutOffsetMm = Math.hypot(nutCenter.x - nutBody.x, nutCenter.y - nutBody.y);
  const passed = boltOffsetMm <= task.coaxiality.toleranceMm && nutOffsetMm <= task.coaxiality.toleranceMm;
  return { status: "PASS", reason: passed ? `Thread axis within ${task.coaxiality.toleranceMm} mm of the body axis on both parts.` : `Thread axis is offset from the body axis (bolt ${boltOffsetMm.toFixed(3)} mm, nut ${nutOffsetMm.toFixed(3)} mm; limit ${task.coaxiality.toleranceMm} mm).`, boltOffsetMm, nutOffsetMm, toleranceMm: task.coaxiality.toleranceMm };
}

export async function scoreThreadSubmission(task: ThreadTask, submission: Submission): Promise<ThreadReport> {
  const sourceSha256 = sha256(submission.source);
  const provenance = { createdAt: new Date().toISOString(), backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native", openscad: openscadVersion(), runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`, platform: process.platform };
  const unknowns = ["A PASS covers nine commanded turns and the listed square-profile geometry contract; it is not ISO metric metrology, torque, preload, strength, wear, self-locking or physical manufacture.", "The tool's overall status may remain NOT_RUN for exit layers outside this task; geometry, engagement/advance and the bench-side coaxiality measurement are scored here.", "Coaxiality is sampled from a two-pitch band's lateral bounding-box centre against the body axis; it is not calibrated metrology, a machining tolerance, thread-flank inspection or a functional fit."];
  const empty: ThreadMeasurements = { parts: 0, exit: null, external: { status: null, pitchMm: null, hand: null, majorDiameterMm: null, minorDiameterMm: null }, internal: { status: null, pitchMm: null, hand: null, majorDiameterMm: null, minorDiameterMm: null }, engagement: null, motion: null, leadPerTurnMm: null, advanceResidualMm: null, turnsCovered: null, coaxiality: null };
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: ThreadMeasurements): ThreadReport => {
    const scored = scoreEvidence(results.map((r) => ({ id: r.id, status: r.status })));
    return { schemaVersion: "thread-bench.case.v1", taskId: task.id, submission: submission.id, expected: expectedOutcome(submission.id), sourcePath: path.relative(process.cwd(), submission.sourcePath), sourceSha256, status, gatePassed: status === "PASS", results, layers: { coverage: scored.coverage, byLayer: scored.layers.map((l) => ({ layer: l.layer, status: l.status, blockers: l.blockers })) }, measurements, provenance, unknowns };
  };
  const blocked = (reason: string): ThreadReport => {
    const results: Result[] = task.requirements.map((r) => ({ id: r.id, layer: r.layer, required: r.required, status: r.applicable ? "ERROR" : "SKIP", reason, observation: { id: r.id, status: "ERROR", reason } }));
    return baseReport(aggregateStatus(results), results, empty);
  };
  let sample: Awaited<ReturnType<typeof sampleThreadedFastener>>;
  try { sample = await sampleThreadedFastener({ scadSource: submission.source, selectors: task.selectors, geometry: task.geometry, motion: task.motion, turns: task.turns, ...(task.poseParameters ? { poseParameters: task.poseParameters } : {}), ...(task.exit ? { exit: task.exit } : {}) }); }
  catch (error) { return blocked(`Thread sample failed: ${error instanceof Error ? error.message : String(error)}`); }
  let parts: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try { parts = await renderAssemblyParts({ scadSource: submission.source, parts: [{ partId: "bolt", selector: task.selectors.bolt }, { partId: "nut", selector: task.selectors.nut }], parameters: { ...(task.poseParameters ?? {}), agentscad_pose: false } }); }
  catch (error) { return blocked(`Bolt/nut meshes did not render: ${error instanceof Error ? error.message : String(error)}`); }
  const coaxiality = measureThreadCoaxiality(task, parts);
  const measurements: ThreadMeasurements = {
    parts: parts.length, exit: statusOf(sample.exit), coaxiality,
    external: { status: statusOf(sample.external), pitchMm: numeric(sample.external.pitchMm), hand: sample.external.hand ?? null, majorDiameterMm: numeric(sample.external.majorDiameterMm), minorDiameterMm: numeric(sample.external.minorDiameterMm) },
    internal: { status: statusOf(sample.internal), pitchMm: numeric(sample.internal.pitchMm), hand: sample.internal.hand ?? null, majorDiameterMm: numeric(sample.internal.majorDiameterMm), minorDiameterMm: numeric(sample.internal.minorDiameterMm) },
    engagement: statusOf(sample.engagement), motion: statusOf(sample.motion),
    leadPerTurnMm: numeric(sample.motion.leadPerTurnMm), advanceResidualMm: numeric(sample.motion.advanceResidualMm), turnsCovered: numeric(sample.motion.turnsCovered),
  };
  const artifactSha256 = sha256(parts.map((part) => part.sha256).join(":"));
  const toolVersion = `thread-bench/1 openscad:${openscadVersion()}`;
  const distinct = new Set(parts.map((part) => part.sha256)).size;
  const distinctObservation: Observation = { id: "distinct-exported-parts", status: "MEASURED", value: distinct, artifactSha256, method: "Part hashes from the bolt and nut selectors.", toolVersion, coverage: `${parts.length} part(s).`, ...(distinct === 2 ? {} : { reason: `Only ${distinct} distinct parts.` }) };
  const frameValues = [statusOf(sample.external), statusOf(sample.internal)];
  const frameMeasured = frameValues.every((status) => status === "PASS" || status === "FAIL");
  const framePass = frameValues.every((status) => status === "PASS");
  const frameObservation: Observation = { id: "measured-joint-frames", status: !frameMeasured ? "NOT_RUN" : "MEASURED", ...(frameMeasured ? { value: framePass } : {}), artifactSha256, method: "Measured external/internal helical pitch, hand and major/minor diameters.", toolVersion, coverage: "Bolt and nut thread geometry.", ...(framePass ? {} : { reason: [sample.external.reason, sample.internal.reason].filter(Boolean).join(" | ") || "Thread geometry did not pass." }) };
  const motionValues = [statusOf(sample.engagement), statusOf(sample.motion)];
  const motionMeasured = motionValues.every((status) => status === "PASS" || status === "FAIL");
  const motionPass = motionValues.every((status) => status === "PASS");
  const motionObservation: Observation = { id: "rigid-motion", status: !motionMeasured ? "NOT_RUN" : "MEASURED", ...(motionMeasured ? { value: motionPass } : {}), artifactSha256, method: "Measured engagement and lead/advance over the commanded turns.", toolVersion, coverage: `${task.turns.length} turns; lead ${measurements.leadPerTurnMm ?? "?"} mm/turn.`, ...(motionPass ? {} : { reason: [sample.engagement.poses.find((pose) => pose.status !== "PASS")?.reason, sample.motion.reason].filter(Boolean).join(" | ") || "Engagement/advance did not pass." }) };
  const exitStatus = statusOf(sample.exit);
  const exitMeasured = exitStatus === "PASS" || exitStatus === "FAIL";
  const exitObservation: Observation = { id: "disassembly-path", status: !exitMeasured ? "NOT_RUN" : "MEASURED", ...(exitMeasured ? { value: exitStatus === "PASS" } : {}), artifactSha256, method: "Frozen full-withdrawal exit sample over the declared turns.", toolVersion, coverage: "One frozen exit contract.", ...(exitStatus === "PASS" ? {} : { reason: sample.exit?.reason ?? `exit ${exitStatus ?? "missing"}.` }) };
  const coaxialityObservation: Observation = coaxiality === null
    ? { id: "thread-coaxiality", status: "NOT_RUN", reason: "No coaxiality contract declared." }
    : coaxiality.status === "PASS"
      ? { id: "thread-coaxiality", status: "MEASURED", value: coaxiality.boltOffsetMm !== null && coaxiality.nutOffsetMm !== null && coaxiality.boltOffsetMm <= coaxiality.toleranceMm && coaxiality.nutOffsetMm <= coaxiality.toleranceMm, artifactSha256, toolVersion,
          method: "Lateral bounding-box centre of a two-pitch thread band against the bolt-head or nut-body axis at pose 0.",
          coverage: `bolt ${coaxiality.boltOffsetMm?.toFixed(3) ?? "?"} mm, nut ${coaxiality.nutOffsetMm?.toFixed(3) ?? "?"} mm; limit ${coaxiality.toleranceMm} mm.`,
          ...(coaxiality.reason.includes("offset") ? { reason: coaxiality.reason } : {}) }
      : { id: "thread-coaxiality", status: coaxiality.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: coaxiality.reason, artifactSha256, toolVersion,
          method: "Lateral bounding-box centre of a two-pitch thread band against the bolt-head or nut-body axis at pose 0.",
          coverage: "Bolt and nut thread bodies." };
  const observations: Record<string, Observation> = { "distinct-exported-parts": distinctObservation, "measured-joint-frames": frameObservation, "rigid-motion": motionObservation, "disassembly-path": exitObservation, "thread-coaxiality": coaxialityObservation };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement({ id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected }, observations[requirement.id]);
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observations[requirement.id]?.value)}, expected ${String(requirement.expected.value)}.` };
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}
