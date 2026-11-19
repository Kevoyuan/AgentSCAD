/**
 * A gear-pair family for the public assembly benchmark.
 *
 * The six-task assembly matrix asks a two-part hinge or piston to fit, move and
 * come apart around a declared axis. This family asks a different question:
 * **does the source rotate two gears in the measured tooth-count ratio, at the
 * declared centre distance, without trusting either number from the source?**
 *
 * The task owns the contract. The submission owns geometry and a pose
 * parameter. Tooth counts, tip/root/pitch estimates, bore axes, marker
 * orientations and the centre distance are measured from the rendered STL
 * triangles by `src/lib/assembly/gear-marker.ts`.
 *
 * It is deliberately a separate directory and command: adding a transmission
 * family to the two-part assembly scorer would change that scorer's contract,
 * and a benchmark that changes its own contract to add a case cannot compare
 * the result to its history.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { evaluateRequirement, type Observation, type Result } from "../../scripts/eval/assembly-evidence";
import {
  checkGearCoupling,
  measureGearMarkerAngle,
  measureGearProfile,
  type GearProfileMeasurement,
  type GearCouplingPose,
} from "../../src/lib/assembly/gear-marker";
import { readBinaryStl, meshBounds, type TriangleMesh } from "../../src/lib/geometry/stl-mesh";
import { renderAssemblyParts } from "../../src/lib/tools/assembly-part-renderer";
import { scoreEvidence } from "../layers";
import {
  aggregateStatus,
  expectedOutcome,
  type BenchRequirement,
  type EvidenceStatus,
  type ExpectedOutcome,
  type Submission,
} from "../assembly/bench";

export interface GearPart {
  id: string;
  selector: string;
}

export interface GearBenchTask {
  schemaVersion: 1;
  id: string;
  prompt: string;
  parts: GearPart[];
  pinionPartId: string;
  wheelPartId: string;
  /** Shared assembly axis; both gear bores are measured along it. */
  axisDirection: [number, number, number];
  pinion: { centerMm: [number, number]; toothCount: number };
  wheel: { centerMm: [number, number]; toothCount: number };
  /** Declared external ratio: negative means opposite rotation. */
  ratio: number;
  centerDistanceMm: number;
  pose: {
    parameter: string;
    values: number[];
    angleToleranceDeg: number;
    ratioTolerance: number;
    centerDistanceToleranceMm: number;
  };
  requirements: BenchRequirement[];
  notes?: string[];
}

export interface GearCaseMeasurements {
  parts: Array<{ partId: string; sha256: string; triangleCount: number; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
  pinion: { toothCount: number | null; pitchRadiusMm: number | null; centerMm: [number, number] | null; axisSource: string | null; markerAngleDeg: number | null } | null;
  wheel: { toothCount: number | null; pitchRadiusMm: number | null; centerMm: [number, number] | null; axisSource: string | null; markerAngleDeg: number | null } | null;
  poses: Array<{ inputDeg: number; pinionAngleDeg: number; wheelAngleDeg: number }>;
  measuredRatio: number | null;
  toothRatio: number | null;
  centerDistanceMm: number | null;
}

export interface GearCaseReport {
  schemaVersion: "gear-bench.case.v1";
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
  measurements: GearCaseMeasurements;
  provenance: {
    createdAt: string;
    backend: string;
    openscad: string;
    runtime: string;
    platform: string;
  };
  unknowns: string[];
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function fail(message: string): never {
  throw new Error(message);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}

function pair(value: unknown, field: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    fail(`${field} must be two finite numbers`);
  }
  return [value[0], value[1]];
}

function vec3(value: unknown, field: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    fail(`${field} must be three finite numbers`);
  }
  return [value[0], value[1], value[2]];
}

function part(value: unknown, field: string): GearPart {
  if (!value || typeof value !== "object") fail(`${field} must be an object`);
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.id)) fail(`${field}.id is invalid`);
  if (typeof raw.selector !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.selector)) fail(`${field}.selector is invalid`);
  return { id: raw.id, selector: raw.selector };
}

/** A malformed task is rejected before any geometry is rendered. */
export function validateGearTask(value: unknown): GearBenchTask {
  if (!value || typeof value !== "object") fail("task must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) fail("task.schemaVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.id)) fail("task.id must be a lowercase kebab-case id");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 8) fail("task.prompt must be a non-trivial string");
  if (!Array.isArray(raw.parts) || raw.parts.length !== 2) fail("task.parts must contain exactly two gears");
  const parts = raw.parts.map((entry, index) => part(entry, `task.parts[${index}]`));
  if (new Set(parts.map((entry) => entry.id)).size !== 2) fail("task.parts ids must be unique");
  if (new Set(parts.map((entry) => entry.selector)).size !== 2) fail("task.parts selectors must be unique");

  const pinionPartId = raw.pinionPartId;
  const wheelPartId = raw.wheelPartId;
  if (typeof pinionPartId !== "string" || !parts.some((entry) => entry.id === pinionPartId)) fail("task.pinionPartId must name one of task.parts");
  if (typeof wheelPartId !== "string" || !parts.some((entry) => entry.id === wheelPartId)) fail("task.wheelPartId must name one of task.parts");
  if (pinionPartId === wheelPartId) fail("task.pinionPartId and task.wheelPartId must be different");

  const axisDirection = vec3(raw.axisDirection, "task.axisDirection");
  if (Math.hypot(...axisDirection) < 1e-9) fail("task.axisDirection must be non-zero");

  const readGear = (key: "pinion" | "wheel") => {
    const gear = raw[key];
    if (!gear || typeof gear !== "object") fail(`task.${key} must be an object`);
    const entry = gear as Record<string, unknown>;
    const centerMm = pair(entry.centerMm, `task.${key}.centerMm`);
    const toothCount = entry.toothCount;
    if (typeof toothCount !== "number" || !Number.isInteger(toothCount) || toothCount < 3 || toothCount > 200) {
      fail(`task.${key}.toothCount must be an integer from 3 to 200`);
    }
    return { centerMm, toothCount };
  };
  const pinion = readGear("pinion");
  const wheel = readGear("wheel");
  if (pinion.toothCount === wheel.toothCount) fail("the two gears must have different tooth counts");

  const ratio = finite(raw.ratio, "task.ratio");
  if (ratio === 0) fail("task.ratio must be nonzero");
  const toothRatio = -pinion.toothCount / wheel.toothCount;
  if (Math.abs(ratio - toothRatio) > 1e-6) fail(`task.ratio ${ratio} does not match -pinion/wheel teeth (${toothRatio})`);
  const centerDistanceMm = finite(raw.centerDistanceMm, "task.centerDistanceMm");
  if (!(centerDistanceMm > 0)) fail("task.centerDistanceMm must be positive");
  const actualCenter = Math.hypot(wheel.centerMm[0] - pinion.centerMm[0], wheel.centerMm[1] - pinion.centerMm[1]);
  if (Math.abs(actualCenter - centerDistanceMm) > 1e-6) fail("task.centerDistanceMm must equal the distance between the declared centres");

  if (!raw.pose || typeof raw.pose !== "object") fail("task.pose must be an object");
  const pose = raw.pose as Record<string, unknown>;
  if (typeof pose.parameter !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(pose.parameter)) fail("task.pose.parameter must be a SCAD identifier");
  if (["agentscad_part", "agentscad_pose"].includes(pose.parameter)) fail("task.pose.parameter must not be a reserved control");
  if (!Array.isArray(pose.values) || pose.values.length < 3 || pose.values.length > 16) fail("task.pose.values must have 3 to 16 entries");
  const values = pose.values.map((item) => finite(item, "task.pose.values[]"));
  if (!values.includes(0)) fail("task.pose.values must include 0, the declared assembly pose");
  if (new Set(values).size !== values.length) fail("task.pose.values must be distinct");
  const angleToleranceDeg = finite(pose.angleToleranceDeg, "task.pose.angleToleranceDeg");
  const ratioTolerance = finite(pose.ratioTolerance, "task.pose.ratioTolerance");
  const centerDistanceToleranceMm = finite(pose.centerDistanceToleranceMm, "task.pose.centerDistanceToleranceMm");
  if (!(angleToleranceDeg > 0) || !(ratioTolerance > 0) || !(centerDistanceToleranceMm > 0)) fail("task.pose tolerances must be positive");

  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) fail("task.requirements must be a non-empty array");
  const requirements: BenchRequirement[] = raw.requirements.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`task.requirements[${index}] must be an object`);
    const requirement = entry as Record<string, unknown>;
    if (typeof requirement.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(requirement.id)) fail(`task.requirements[${index}].id is invalid`);
    if (!["parts", "assembly", "motion", "physical"].includes(String(requirement.layer))) fail(`task.requirements[${index}].layer is invalid`);
    if (typeof requirement.required !== "boolean") fail(`task.requirements[${index}].required must be boolean`);
    if (typeof requirement.applicable !== "boolean") fail(`task.requirements[${index}].applicable must be boolean`);
    const expected = requirement.expected as Record<string, unknown> | undefined;
    if (!expected || typeof expected !== "object" || expected.kind !== "equals") fail(`task.requirements[${index}].expected must be an exact value`);
    if (!["string", "boolean", "number"].includes(typeof expected.value)) fail(`task.requirements[${index}].expected.value has an unsupported type`);
    if (typeof expected.value === "number" && !Number.isFinite(expected.value)) fail(`task.requirements[${index}].expected.value must be finite`);
    return { id: requirement.id, layer: requirement.layer as BenchRequirement["layer"], required: requirement.required, applicable: requirement.applicable, expected: { kind: "equals", value: expected.value as string | boolean | number } };
  });
  if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length) fail("task.requirements ids must be unique");
  const observable = new Set(["distinct-exported-parts", "rigid-motion"]);
  for (const requirement of requirements) {
    if (!observable.has(requirement.id)) fail(`task.requirements id "${requirement.id}" has no observer in this gear benchmark`);
  }

  return {
    schemaVersion: 1,
    id: raw.id,
    prompt: raw.prompt,
    parts,
    pinionPartId,
    wheelPartId,
    axisDirection,
    pinion,
    wheel,
    ratio,
    centerDistanceMm,
    pose: { parameter: pose.parameter, values, angleToleranceDeg, ratioTolerance, centerDistanceToleranceMm },
    requirements,
    ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter((note): note is string => typeof note === "string") } : {}),
  };
}

export function gearTasksDirectory(): string {
  return path.join(import.meta.dir, "tasks");
}

export function gearSubmissionsDirectory(): string {
  return path.join(import.meta.dir, "submissions");
}

export async function loadGearTasks(root = gearTasksDirectory()): Promise<GearBenchTask[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  const tasks: GearBenchTask[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(root, name), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`${name}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      tasks.push(validateGearTask(parsed));
    } catch (error) {
      fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (tasks.length === 0) fail(`no gear tasks found under ${root}`);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) fail("gear task ids must be unique");
  return tasks;
}

export async function loadGearSubmissions(taskId: string, root = gearSubmissionsDirectory()): Promise<Submission[]> {
  const directory = path.join(root, taskId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".scad")).sort();
  } catch {
    return [];
  }
  const submissions: Submission[] = [];
  for (const name of names) {
    const sourcePath = path.join(directory, name);
    submissions.push({
      taskId,
      id: name.replace(/\.scad$/, ""),
      sourcePath,
      source: await readFile(sourcePath, "utf8"),
    });
  }
  return submissions;
}

/** Order-independent triangle hash, so a shuffled STL is not a distinct part. */
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

function profileSummary(profile: GearProfileMeasurement) {
  return {
    toothCount: profile.toothCount,
    pitchRadiusMm: profile.pitchRadiusMm,
    centerMm: profile.centerMm,
    axisSource: profile.axisSource,
    markerAngleDeg: profile.marker?.angleDeg ?? null,
  };
}

export async function scoreGearSubmission(task: GearBenchTask, submission: Submission): Promise<GearCaseReport> {
  const startedAt = Date.now();
  const sourceSha256 = sha256(submission.source);
  const pinionPart = task.parts.find((entry) => entry.id === task.pinionPartId)!;
  const wheelPart = task.parts.find((entry) => entry.id === task.wheelPartId)!;
  const provenance = {
    createdAt: new Date().toISOString(),
    backend: process.env.AGENTSCAD_OPENSCAD_BACKEND === "wasm" ? "wasm" : "native",
    openscad: openscadVersion(),
    runtime: `bun ${process.env.BUN_VERSION ?? "unknown"}`,
    platform: process.platform,
  };
  const unknowns = [
    "A PASS covers the listed input angles, the measured tooth counts and one measured centre distance; it is not a proof of tooth contact, backlash, load, efficiency or physical function.",
    "The gear profiles are straight-sided full-depth estimates; pitch radius is estimated from measured tip/root radii, not a metrology-grade pitch circle.",
    "The markers are measurement features; the check does not prove that a marker is the intended feature of an arbitrary generated part.",
  ];
  const baseReport = (status: EvidenceStatus, results: Result[], measurements: GearCaseMeasurements): GearCaseReport => {
    const scored = scoreEvidence([...results.map((result) => ({ id: result.id, status: result.status }))]);
    return {
      schemaVersion: "gear-bench.case.v1",
      taskId: task.id,
      submission: submission.id,
      expected: expectedOutcome(submission.id),
      sourcePath: path.relative(process.cwd(), submission.sourcePath),
      sourceSha256,
      status,
      gatePassed: status === "PASS",
      results,
      layers: { coverage: scored.coverage, byLayer: scored.layers.map((layer) => ({ layer: layer.layer, status: layer.status, blockers: layer.blockers })) },
      measurements,
      provenance,
      unknowns,
    };
  };
  const emptyMeasurements: GearCaseMeasurements = {
    parts: [], pinion: null, wheel: null, poses: [], measuredRatio: null, toothRatio: null, centerDistanceMm: null,
  };

  let rendered: Awaited<ReturnType<typeof renderAssemblyParts>>;
  try {
    rendered = await renderAssemblyParts({
      scadSource: submission.source,
      parts: task.parts.map((entry) => ({ partId: entry.id, selector: entry.selector })),
      parameters: { [task.pose.parameter]: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const results: Result[] = task.requirements.map((requirement) => ({
      id: requirement.id, layer: requirement.layer, required: requirement.required,
      status: requirement.applicable ? "ERROR" : "SKIP",
      reason: `The submission did not render at the assembled pose: ${reason}`,
      observation: { id: requirement.id, status: "ERROR", reason },
    }));
    const report = baseReport(aggregateStatus(results), results, { ...emptyMeasurements, parts: [] });
    report.unknowns = [...unknowns, `Render error: ${reason}`];
    return report;
  }

  const parts = rendered.map((entry) => {
    const mesh = readBinaryStl(entry.stl);
    const bounds = meshBounds(mesh);
    return { ...entry, mesh, bounds };
  });
  const stlArtifact = sha256(parts.map((entry) => entry.sha256).join(":"));
  const toolVersion = `gear-bench/1 openscad:${openscadVersion()}`;
  const measurements: GearCaseMeasurements = {
    ...emptyMeasurements,
    parts: parts.map((entry) => ({ partId: entry.partId, sha256: entry.sha256, triangleCount: entry.triangleCount, bounds: entry.bounds })),
  };

  const pinionRendered = parts.find((entry) => entry.partId === task.pinionPartId)!;
  const wheelRendered = parts.find((entry) => entry.partId === task.wheelPartId)!;
  const pinion = measureGearProfile({ stl: pinionRendered.stl, mode: "external", center: task.pinion.centerMm, axisDirection: task.axisDirection });
  const wheel = measureGearProfile({ stl: wheelRendered.stl, mode: "external", center: task.wheel.centerMm, axisDirection: task.axisDirection });
  measurements.pinion = profileSummary(pinion);
  measurements.wheel = profileSummary(wheel);

  // Distinct exported parts is measured on the canonical triangle table, not
  // the raw STL hash: two selectors that emit the same solid are one part.
  const distinctCount = new Set(parts.map((entry) => canonicalMeshHash(entry.mesh))).size;
  const distinctObservation: Observation = {
    id: "distinct-exported-parts", status: "MEASURED", value: distinctCount,
    artifactSha256: stlArtifact, method: "Canonical order-independent triangle hash per rendered gear.",
    toolVersion, coverage: `${parts.length} rendered gear(s): ${parts.map((entry) => `${entry.partId}=${entry.triangleCount} triangles`).join(", ")}.`,
    ...(distinctCount === parts.length ? {} : { reason: `Only ${distinctCount} distinct solid(s) across ${parts.length} selectors.` }),
  };

  const profilesReady = pinion.status === "MEASURED" && wheel.status === "MEASURED"
    && pinion.marker !== null && wheel.marker !== null
    && pinion.axisSource === "bore" && wheel.axisSource === "bore";
  const poses: GearCouplingPose[] = [];
  let poseError: string | null = null;
  if (profilesReady) {
    for (const value of task.pose.values) {
      try {
        const [pinionPose, wheelPose] = await renderAssemblyParts({
          scadSource: submission.source,
          parts: [
            { partId: task.pinionPartId, selector: pinionPart.selector },
            { partId: task.wheelPartId, selector: wheelPart.selector },
          ],
          parameters: { [task.pose.parameter]: value },
        });
        const pinionMarker = measureGearMarkerAngle({
          stl: pinionPose.stl, center: pinion.centerMm!,
          minRadiusMm: pinion.marker!.bandMm.min, maxRadiusMm: pinion.marker!.bandMm.max,
        });
        const wheelMarker = measureGearMarkerAngle({
          stl: wheelPose.stl, center: wheel.centerMm!,
          minRadiusMm: wheel.marker!.bandMm.min, maxRadiusMm: wheel.marker!.bandMm.max,
        });
        if (pinionMarker.status !== "MEASURED" || pinionMarker.angleDeg === null
          || wheelMarker.status !== "MEASURED" || wheelMarker.angleDeg === null) {
          poseError = `pose ${value}: ${pinionMarker.reason} / ${wheelMarker.reason}`;
          break;
        }
        poses.push({ inputDeg: value, pinionAngleDeg: pinionMarker.angleDeg, wheelAngleDeg: wheelMarker.angleDeg });
      } catch (error) {
        poseError = `pose ${value}: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
  }
  measurements.poses = poses;

  let couplingObservation: Observation;
  if (!profilesReady) {
    const issue = (profile: GearProfileMeasurement) => [
      profile.status,
      profile.marker ? null : "no index marker",
      profile.axisSource === "bore" ? null : `axis from ${profile.axisSource ?? "none"}`,
    ].filter(Boolean).join(", ");
    couplingObservation = {
      id: "rigid-motion", status: "NOT_RUN",
      reason: `Gear evidence is incomplete: pinion ${issue(pinion)} (${pinion.reason}); wheel ${issue(wheel)} (${wheel.reason}).`,
      toolVersion,
    };
  } else if (poseError) {
    couplingObservation = { id: "rigid-motion", status: "NOT_RUN", reason: `A pose marker could not be measured: ${poseError}`, toolVersion };
  } else {
    const coupling = checkGearCoupling({
      poses, pinion, wheel, expectedRatio: task.ratio,
      angleToleranceDeg: task.pose.angleToleranceDeg, ratioTolerance: task.pose.ratioTolerance,
      centerDistanceToleranceMm: task.pose.centerDistanceToleranceMm,
    });
    measurements.measuredRatio = coupling.measuredRatio ?? null;
    measurements.toothRatio = coupling.toothRatio ?? null;
    measurements.centerDistanceMm = coupling.centerDistanceMm ?? null;
    const countsOk = pinion.toothCount === task.pinion.toothCount && wheel.toothCount === task.wheel.toothCount;
    if (coupling.status === "NOT_RUN") {
      couplingObservation = { id: "rigid-motion", status: "NOT_RUN", reason: coupling.reason, toolVersion };
    } else {
      const passed = coupling.status === "PASS" && countsOk;
      couplingObservation = {
        id: "rigid-motion", status: "MEASURED", value: passed,
        artifactSha256: stlArtifact,
        method: "Re-rendered both selectors through the source pose parameter; measured tooth counts, pitch estimates, bore axes/centres and marker orientation, then compared the marker ratio and measured centre distance with the declared tooth-count ratio.",
        toolVersion,
        coverage: `${poses.length} input angle(s) (${task.pose.values.join(", ")} ${"deg"}); ${coupling.coverage}`,
        ...(passed ? {} : { reason: countsOk ? coupling.reason : `Measured teeth ${pinion.toothCount}/${wheel.toothCount} do not match the declared ${task.pinion.toothCount}/${task.wheel.toothCount}. ${coupling.reason}` }),
      };
    }
  }

  const observations: Record<string, Observation> = {
    "distinct-exported-parts": distinctObservation,
    "rigid-motion": couplingObservation,
  };
  const results: Result[] = task.requirements.map((requirement) => {
    const evaluated = evaluateRequirement(
      { id: requirement.id, layer: requirement.layer, required: requirement.required, applicable: requirement.applicable, expected: requirement.expected },
      observations[requirement.id],
    );
    if (evaluated.status === "FAIL" && requirement.expected.kind === "equals") {
      const observed = observations[requirement.id]?.value;
      return { ...evaluated, reason: `${evaluated.reason} Observed ${String(observed)}, expected ${String(requirement.expected.value)}.` };
    }
    return evaluated;
  });
  return baseReport(aggregateStatus(results), results, measurements);
}