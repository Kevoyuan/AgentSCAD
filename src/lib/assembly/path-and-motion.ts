/**
 * Disassembly path and motion sampling for a declared joint.
 *
 * Both checks ask the same geometric question at many poses: does the moving
 * part interfere with anything it is not supposed to touch? Neither proves that
 * a real part can be assembled, that a hand can reach it, or that the motion is
 * smooth. They prove only that the sampled poses are free of interference.
 *
 * Rules that keep the result honest:
 *
 * - A pose is only `clear` when every pair was examined. An undecided collision
 *   makes the whole check `NOT_RUN`, never `PASS`.
 * - The path distance and the step count are reported, because "the path is
 *   clear" means nothing without them. A gap narrower than the step can hide
 *   between samples, and the coverage string says so.
 * - Tolerated contacts (`allowedContact`) are counted and named. A pass that
 *   depends on them is not the same as a pass without them.
 */
import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";
import { buildBvh, placeBvh, bvhIntersects, transformPoint, type Bvh, type CollisionStatus, type Mat4 } from "../geometry/mesh-collision";
import { readBinaryStl, type TriangleMesh, type Vec3 } from "../geometry/stl-mesh";

export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "ERROR";

const MAX_MESH_BYTES = 64 * 1024 * 1024;
const DEFAULT_PATH_STEPS = 24;
const DEFAULT_MOTION_STEPS = 24;
const DEFAULT_EPSILON_MM = 1e-6;

type Vec = [number, number, number];

/** Validate before mesh loading or loops: NaN samples otherwise skip all poses. */
function samplingInputError(input: { steps?: number; epsilonMm?: number; maxPairTests?: number }): string | null {
  if (input.steps !== undefined && (!Number.isInteger(input.steps) || input.steps < 2 || input.steps > 4096)) {
    return "steps must be an integer between 2 and 4096";
  }
  if (input.epsilonMm !== undefined && (!Number.isFinite(input.epsilonMm) || input.epsilonMm <= 0 || input.epsilonMm > 0.1)) {
    return "epsilonMm must be finite, positive and at most 0.1 mm";
  }
  if (input.maxPairTests !== undefined && (!Number.isInteger(input.maxPairTests) || input.maxPairTests < 1 || input.maxPairTests > 2_000_000)) {
    return "maxPairTests must be an integer between 1 and 2000000";
  }
  return null;
}


function applyPoint(matrix: number[], point: Vec): Vec {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

function applyDirection(matrix: number[], direction: Vec): Vec {
  return [
    matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2],
    matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2],
    matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2],
  ];
}

/** Row-major product, so `multiply(rotation, instance)` applies rotation afterwards. */
export function multiplyMatrices(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[row * 4 + k] * b[k * 4 + column];
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

/** Rotation about a line in world space, as a row-major 4x4. */
export function rotationAboutAxis(origin: Vec3, direction: Vec3, radians: number): number[] {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) throw new Error("A rotation axis needs a finite, non-zero direction");
  const x = direction[0] / length, y = direction[1] / length, z = direction[2] / length;
  const c = Math.cos(radians), s = Math.sin(radians), t = 1 - c;
  const r = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
  // Translation that makes the rotation happen about `origin` instead of the world origin.
  const translation = [
    origin[0] - (r[0] * origin[0] + r[1] * origin[1] + r[2] * origin[2]),
    origin[1] - (r[3] * origin[0] + r[4] * origin[1] + r[5] * origin[2]),
    origin[2] - (r[6] * origin[0] + r[7] * origin[1] + r[8] * origin[2]),
  ];
  return [r[0], r[1], r[2], translation[0], r[3], r[4], r[5], translation[1], r[6], r[7], r[8], translation[2], 0, 0, 0, 1];
}

export function translationMatrix(offset: Vec): number[] {
  return [1, 0, 0, offset[0], 0, 1, 0, offset[1], 0, 0, 1, offset[2], 0, 0, 0, 1];
}

export interface PosePairResult {
  movingInstanceId: string;
  otherInstanceId: string;
  status: CollisionStatus;
  blocked: boolean;
  testedPairs: number;
  reason: string;
  tolerated: boolean;
}

export interface PathSample {
  /** Signed offset along the joint axis from the assembled pose, in mm. */
  offsetMm: number;
  direction: 1 | -1;
  worst: "CLEAR" | "BLOCKED" | "UNDECIDED";
  blocking: PosePairResult[];
}

export interface DisassemblyPathEvidence {
  status: CheckStatus;
  reason: string;
  connectionId: string;
  axis: { origin: Vec3; direction: Vec3 } | null;
  /** The direction that produced the verdict; null when neither was clear. */
  clearDirection: 1 | -1 | null;
  steps: number;
  distanceMm: number;
  stepMm: number;
  posesEvaluated: number;
  collisionTests: number;
  toleratedContacts: number;
  /** First pose that blocked, with the pairs responsible. */
  blockedAt: PathSample | null;
  coverage: string;
  unknowns: string[];
}

export interface MotionSample {
  angleDeg: number;
  worst: "CLEAR" | "BLOCKED" | "UNDECIDED";
  blocking: PosePairResult[];
}

export interface MotionRangeEvidence {
  status: CheckStatus;
  reason: string;
  connectionId: string;
  rangeDeg: { min: number; max: number } | null;
  steps: number;
  stepDeg: number;
  posesEvaluated: number;
  collisionTests: number;
  toleratedContacts: number;
  blockedAt: MotionSample | null;
  coverage: string;
  unknowns: string[];
}

interface ResolvedJoint {
  spec: AssemblySpec;
  connection: AssemblySpec["connections"][number];
  axis: { origin: Vec3; direction: Vec3 };
  movingInstanceIds: string[];
  otherInstanceIds: string[];
}

function resolveJoint(input: {
  spec: unknown;
  connectionId: string;
  movingInstanceIds?: string[];
}): { joint: ResolvedJoint } | { error: string; status: CheckStatus } {
  const parsed = validateAssemblySpec(input.spec);
  if (!parsed.success) return { error: "Invalid assembly specification.", status: "ERROR" };
  const spec = parsed.data;
  const connection = spec.connections.find((item) => item.id === input.connectionId);
  if (!connection) return { error: "Unknown connection.", status: "ERROR" };
  if (connection.type !== "revolute") return { error: `Connection type "${connection.type}" has no revolute axis to sample.`, status: "NOT_RUN" };
  if (!connection.frameA || !connection.frameB) return { error: "A revolute joint needs a frame on both instances.", status: "ERROR" };
  const instanceA = spec.instances.find((item) => item.id === connection.a);
  const instanceB = spec.instances.find((item) => item.id === connection.b);
  if (!instanceA || !instanceB) return { error: "Connection refers to a missing instance.", status: "ERROR" };

  const direction = applyDirection(instanceA.transform, connection.frameA.direction);
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) return { error: "The joint frame has no usable direction.", status: "ERROR" };
  const axis = {
    origin: applyPoint(instanceA.transform, connection.frameA.origin),
    direction: [direction[0] / length, direction[1] / length, direction[2] / length] as Vec3,
  };

  const moving = input.movingInstanceIds ?? [connection.b];
  if (moving.length === 0) return { error: "At least one moving instance must be named.", status: "ERROR" };
  const known = new Set(spec.instances.map((item) => item.id));
  for (const id of moving) if (!known.has(id)) return { error: `Moving instance "${id}" does not exist.`, status: "ERROR" };
  const others = spec.instances.map((item) => item.id).filter((id) => !moving.includes(id));
  if (others.length === 0) return { error: "There is no other instance to collide with.", status: "NOT_RUN" };
  return { joint: { spec, connection, axis, movingInstanceIds: [...moving], otherInstanceIds: others } };
}

function loadMeshes(spec: AssemblySpec, buffers: Record<string, Buffer>, instanceIds: string[]): { meshes: Map<string, Bvh> } | { error: string } {
  const byInstance = new Map<string, Bvh>();
  const cache = new Map<string, Bvh>();
  for (const instanceId of instanceIds) {
    const instance = spec.instances.find((item) => item.id === instanceId);
    if (!instance) return { error: `Instance "${instanceId}" does not exist.` };
    const part = spec.parts.find((item) => item.id === instance.partId);
    if (!part) return { error: `Instance "${instanceId}" refers to a missing part.` };
    if (part.source !== "generated") return { error: `Part "${part.id}" is purchased and has no mesh to check.` };
    let bvh = cache.get(part.id);
    if (!bvh) {
      const buffer = buffers[part.id];
      if (!buffer) return { error: `Part "${part.id}" has no mesh.` };
      if (buffer.length > MAX_MESH_BYTES) return { error: `Part "${part.id}" exceeds the collision budget.` };
      let mesh: TriangleMesh;
      try { mesh = readBinaryStl(buffer); } catch (error) { return { error: `Part "${part.id}" mesh is unreadable: ${error instanceof Error ? error.message : "unknown"}.` }; }
      bvh = buildBvh(mesh);
      cache.set(part.id, bvh);
    }
    byInstance.set(instanceId, bvh);
  }
  return { meshes: byInstance };
}

/** Pairs whose two parts both appear in `allowedContact` do not block. */
function isTolerated(spec: AssemblySpec, allowedContact: string[], a: string, b: string): boolean {
  if (allowedContact.length === 0) return false;
  const partOf = (instanceId: string) => spec.instances.find((item) => item.id === instanceId)?.partId;
  const partA = partOf(a), partB = partOf(b);
  if (!partA || !partB) return false;
  return allowedContact.includes(partA) && allowedContact.includes(partB);
}

interface PoseVerdict {
  pairs: PosePairResult[];
  worst: "CLEAR" | "BLOCKED" | "UNDECIDED";
  tests: number;
  tolerated: number;
}

function evaluatePose(options: {
  spec: AssemblySpec;
  meshes: Map<string, Bvh>;
  movingInstanceIds: string[];
  otherInstanceIds: string[];
  matrices: Map<string, Mat4>;
  allowedContact: string[];
  epsilonMm: number;
  maxPairTests: number;
}): PoseVerdict {
  const placed = new Map<string, ReturnType<typeof placeBvh>>();
  for (const [instanceId, bvh] of options.meshes) placed.set(instanceId, placeBvh(bvh, options.matrices.get(instanceId) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const pairs: PosePairResult[] = [];
  let tests = 0;
  let tolerated = 0;
  for (const movingId of options.movingInstanceIds) {
    const moving = placed.get(movingId);
    if (!moving) continue;
    for (const otherId of options.otherInstanceIds) {
      const other = placed.get(otherId);
      if (!other) continue;
      const result = bvhIntersects(moving, other, { epsilonMm: options.epsilonMm, maxPairTests: options.maxPairTests });
      tests += result.testedPairs;
      const toleratedPair = result.status !== "UNKNOWN" && result.blocked && isTolerated(options.spec, options.allowedContact, movingId, otherId);
      if (toleratedPair) tolerated++;
      pairs.push({
        movingInstanceId: movingId,
        otherInstanceId: otherId,
        status: result.status,
        blocked: result.blocked && !toleratedPair,
        testedPairs: result.testedPairs,
        reason: result.reason,
        tolerated: toleratedPair,
      });
    }
  }
  const blocking = pairs.filter((pair) => pair.blocked);
  const worst = blocking.length > 0
    ? (blocking.some((pair) => pair.status === "INTERSECT" || pair.status === "CONTAINED") ? "BLOCKED" : "UNDECIDED")
    : "CLEAR";
  return { pairs, worst, tests, tolerated };
}

/** Axial span of every instance along the joint axis, so the exit distance is derived rather than guessed. */
function axialSpan(spec: AssemblySpec, meshes: Map<string, Bvh>, axis: { origin: Vec3; direction: Vec3 }): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const instance of spec.instances) {
    const bvh = meshes.get(instance.id);
    if (!bvh || bvh.mesh.triangleCount === 0) continue;
    const placed = placeBvh(bvh, instance.transform);
    for (let corner = 0; corner < 8; corner++) {
      const point: Vec3 = [
        corner & 1 ? placed.worldBounds[3] : placed.worldBounds[0],
        corner & 2 ? placed.worldBounds[4] : placed.worldBounds[1],
        corner & 4 ? placed.worldBounds[5] : placed.worldBounds[2],
      ];
      const value = (point[0] - axis.origin[0]) * axis.direction[0]
        + (point[1] - axis.origin[1]) * axis.direction[1]
        + (point[2] - axis.origin[2]) * axis.direction[2];
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return { min, max };
}

/**
 * Slides the moving instances along the joint axis and reports whether any
 * sampled pose interferes. Both directions are tried, because a part may come
 * out either way and the declaration does not say which.
 */
export function checkDisassemblyPath(input: {
  spec: unknown;
  /** Part meshes in part-local coordinates, keyed by part ID. */
  meshes: Record<string, Buffer>;
  connectionId: string;
  movingInstanceIds?: string[];
  steps?: number;
  /** Extra travel beyond the point where the parts no longer overlap. */
  marginMm?: number;
  epsilonMm?: number;
  maxPairTests?: number;
}): DisassemblyPathEvidence {
  const unknowns = [
    "Only the sampled offsets are covered; a gap narrower than one step can be missed.",
    "The path is a straight line along the declared axis; a real part may need a different route.",
    "No clearance to a hand, tool or printer is modelled.",
  ];
  const base: DisassemblyPathEvidence = {
    status: "NOT_RUN", reason: "", connectionId: input.connectionId, axis: null, clearDirection: null,
    steps: 0, distanceMm: 0, stepMm: 0, posesEvaluated: 0, collisionTests: 0, toleratedContacts: 0,
    blockedAt: null, coverage: "", unknowns,
  };
  const samplingError = samplingInputError(input);
  if (samplingError) return { ...base, status: "ERROR", reason: samplingError };
  const resolved = resolveJoint(input);
  if ("error" in resolved) return { ...base, status: resolved.status, reason: resolved.error };
  const { joint } = resolved;
  const loaded = loadMeshes(joint.spec, input.meshes, [...joint.movingInstanceIds, ...joint.otherInstanceIds]);
  if ("error" in loaded) return { ...base, status: "NOT_RUN", reason: loaded.error, axis: joint.axis };
  const meshes = loaded.meshes;

  const steps = input.steps ?? DEFAULT_PATH_STEPS;
  const margin = input.marginMm ?? 1;
  if (!Number.isFinite(margin) || margin < 0) return { ...base, status: "ERROR", reason: "marginMm must be finite and non-negative", axis: joint.axis };
  const span = axialSpan(joint.spec, meshes, joint.axis);
  if (!Number.isFinite(span.min) || !Number.isFinite(span.max)) return { ...base, status: "NOT_RUN", reason: "No mesh covers the joint axis, so the exit distance is unknown.", axis: joint.axis };
  const distance = Math.max(0, span.max - span.min) + margin;
  if (!(distance > 0)) return { ...base, status: "NOT_RUN", reason: "The parts have no extent along the joint axis, so there is no path to sample.", axis: joint.axis };
  const step = distance / (steps - 1);

  const instanceTransforms = new Map(joint.spec.instances.map((instance) => [instance.id, instance.transform]));
  let posesEvaluated = 0, collisionTests = 0, toleratedContacts = 0;
  let firstBlocked: PathSample | null = null;
  let undecided = false;
  const allowedContact = joint.connection.allowedContact;

  for (const direction of [1, -1] as const) {
    let clear = true;
    for (let index = 0; index < steps; index++) {
      const offsetMm = direction * index * step;
      const shift = translationMatrix([joint.axis.direction[0] * offsetMm, joint.axis.direction[1] * offsetMm, joint.axis.direction[2] * offsetMm]);
      const matrices = new Map<string, Mat4>();
      for (const [instanceId, transform] of instanceTransforms) {
        matrices.set(instanceId, joint.movingInstanceIds.includes(instanceId) ? multiplyMatrices(shift, transform) : transform);
      }
      const verdict = evaluatePose({
        spec: joint.spec, meshes, movingInstanceIds: joint.movingInstanceIds, otherInstanceIds: joint.otherInstanceIds,
        matrices, allowedContact, epsilonMm: input.epsilonMm ?? DEFAULT_EPSILON_MM, maxPairTests: input.maxPairTests ?? 200_000,
      });
      posesEvaluated++;
      collisionTests += verdict.tests;
      toleratedContacts += verdict.tolerated;
      if (verdict.worst === "BLOCKED") {
        const sample: PathSample = { offsetMm, direction, worst: "BLOCKED", blocking: verdict.pairs.filter((pair) => pair.blocked) };
        firstBlocked ??= sample;
        clear = false;
        break;
      }
      if (verdict.worst === "UNDECIDED") undecided = true;
    }
    if (clear) {
      const coverage = `${steps} offsets of ${step.toFixed(3)} mm along ±${direction > 0 ? "+" : "−"}axis over ${distance.toFixed(3)} mm; ${joint.movingInstanceIds.length} moving instance(s) against ${joint.otherInstanceIds.length} other(s)`;
      const note = toleratedContacts > 0 ? ` ${toleratedContacts} contact(s) were tolerated by the declaration and are not counted as clear.` : "";
      return {
        ...base, status: undecided ? "NOT_RUN" : "PASS",
        reason: undecided
          ? `The path along direction ${direction} was free at every sampled offset, but at least one pose could not be decided, so the path is not proven clear.${note}`
          : `Every sampled offset along direction ${direction} was free of interference.${note}`,
        axis: joint.axis, clearDirection: direction, steps, distanceMm: distance, stepMm: step,
        posesEvaluated, collisionTests, toleratedContacts, blockedAt: null, coverage,
      };
    }
  }

  const blockingPair = firstBlocked?.blocking[0];
  return {
    ...base, status: "FAIL",
    reason: blockingPair
      ? `Sliding out is blocked at ${firstBlocked!.offsetMm.toFixed(3)} mm: ${blockingPair.movingInstanceId} interferes with ${blockingPair.otherInstanceId} (${blockingPair.status}). ${blockingPair.reason}`
      : "Sliding out is blocked before the parts separate.",
    axis: joint.axis, clearDirection: null, steps, distanceMm: distance, stepMm: step,
    posesEvaluated, collisionTests, toleratedContacts, blockedAt: firstBlocked,
    coverage: `${posesEvaluated} offsets evaluated in both directions before the first block`,
  };
}

/**
 * Rotates the moving instances across the declared range and reports whether any
 * sampled angle interferes.
 */
export function checkMotionRange(input: {
  spec: unknown;
  meshes: Record<string, Buffer>;
  connectionId: string;
  movingInstanceIds?: string[];
  steps?: number;
  epsilonMm?: number;
  maxPairTests?: number;
}): MotionRangeEvidence {
  const unknowns = [
    "Only the sampled angles are covered; a narrow obstruction between samples can be missed.",
    "The rotation is geometric; torque, friction, play and self-locking are not modelled.",
    "Motion is about the declared axis; a real mechanism may translate as well as rotate.",
  ];
  const base: MotionRangeEvidence = {
    status: "NOT_RUN", reason: "", connectionId: input.connectionId, rangeDeg: null,
    steps: 0, stepDeg: 0, posesEvaluated: 0, collisionTests: 0, toleratedContacts: 0,
    blockedAt: null, coverage: "", unknowns,
  };
  const samplingError = samplingInputError(input);
  if (samplingError) return { ...base, status: "ERROR", reason: samplingError };
  const resolved = resolveJoint(input);
  if ("error" in resolved) return { ...base, status: resolved.status, reason: resolved.error };
  const { joint } = resolved;
  const range = joint.connection.range;
  if (!range) return { ...base, status: "NOT_RUN", reason: "The joint declares no motion range, so there is nothing to sample." };
  if (range.unit !== "deg") return { ...base, status: "NOT_RUN", reason: `Range unit "${range.unit}" is not an angle; this check only samples rotations.` };
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) return { ...base, status: "ERROR", reason: "The declared range is not a valid interval.", rangeDeg: { min: range.min, max: range.max } };
  const loaded = loadMeshes(joint.spec, input.meshes, [...joint.movingInstanceIds, ...joint.otherInstanceIds]);
  if ("error" in loaded) return { ...base, status: "NOT_RUN", reason: loaded.error, rangeDeg: { min: range.min, max: range.max } };
  const meshes = loaded.meshes;

  const steps = input.steps ?? DEFAULT_MOTION_STEPS;
  const stepDeg = (range.max - range.min) / (steps - 1);
  const instanceTransforms = new Map(joint.spec.instances.map((instance) => [instance.id, instance.transform]));
  let posesEvaluated = 0, collisionTests = 0, toleratedContacts = 0;
  let firstBlocked: MotionSample | null = null;
  let undecided = false;

  for (let index = 0; index < steps; index++) {
    const angleDeg = range.min + index * stepDeg;
    const rotation = rotationAboutAxis(joint.axis.origin, joint.axis.direction, (angleDeg * Math.PI) / 180);
    const matrices = new Map<string, Mat4>();
    for (const [instanceId, transform] of instanceTransforms) {
      matrices.set(instanceId, joint.movingInstanceIds.includes(instanceId) ? multiplyMatrices(rotation, transform) : transform);
    }
    const verdict = evaluatePose({
      spec: joint.spec, meshes, movingInstanceIds: joint.movingInstanceIds, otherInstanceIds: joint.otherInstanceIds,
      matrices, allowedContact: joint.connection.allowedContact, epsilonMm: input.epsilonMm ?? DEFAULT_EPSILON_MM, maxPairTests: input.maxPairTests ?? 200_000,
    });
    posesEvaluated++;
    collisionTests += verdict.tests;
    toleratedContacts += verdict.tolerated;
    if (verdict.worst === "BLOCKED") {
      firstBlocked = { angleDeg, worst: "BLOCKED", blocking: verdict.pairs.filter((pair) => pair.blocked) };
      break;
    }
    if (verdict.worst === "UNDECIDED") undecided = true;
  }

  const rangeDeg = { min: range.min, max: range.max };
  const coverage = `${posesEvaluated} angles of ${Math.abs(stepDeg).toFixed(3)}° covering ${range.min}° to ${range.max}°; ${joint.movingInstanceIds.length} moving instance(s) against ${joint.otherInstanceIds.length} other(s)`;
  const note = toleratedContacts > 0 ? ` ${toleratedContacts} contact(s) were tolerated by the declaration and are not counted as clear.` : "";
  if (firstBlocked) {
    const pair = firstBlocked.blocking[0];
    return {
      ...base, status: "FAIL",
      reason: pair
        ? `Rotation is blocked at ${firstBlocked.angleDeg.toFixed(2)}°: ${pair.movingInstanceId} interferes with ${pair.otherInstanceId} (${pair.status}). ${pair.reason}`
        : `Rotation is blocked at ${firstBlocked.angleDeg.toFixed(2)}°.`,
      rangeDeg, steps, stepDeg: Math.abs(stepDeg), posesEvaluated, collisionTests, toleratedContacts, blockedAt: firstBlocked, coverage,
    };
  }
  return {
    ...base, status: undecided ? "NOT_RUN" : "PASS",
    reason: undecided
      ? "Every sampled angle was free, but at least one pose could not be decided, so the range is not proven clear."
      : `Every sampled angle between ${range.min}° and ${range.max}° was free of interference.${note}`,
    rangeDeg, steps, stepDeg: Math.abs(stepDeg), posesEvaluated, collisionTests, toleratedContacts, blockedAt: null, coverage,
  };
}

export function checkKinematics(input: {
  spec: unknown;
  meshes: Record<string, Buffer>;
  connectionId: string;
  movingInstanceIds?: string[];
  pathSteps?: number;
  motionSteps?: number;
  epsilonMm?: number;
  maxPairTests?: number;
}): { path: DisassemblyPathEvidence; motion: MotionRangeEvidence } {
  return {
    path: checkDisassemblyPath({ ...input, steps: input.pathSteps }),
    motion: checkMotionRange({ ...input, steps: input.motionSteps }),
  };
}
