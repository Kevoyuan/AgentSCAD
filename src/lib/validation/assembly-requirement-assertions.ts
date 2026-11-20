import type { AssemblySpec } from "../assembly/assembly-spec";
import type { prepareContractAssembly } from "../assembly/prepare-contract-assembly";
import { multiplyMatrices, rotationAboutAxis } from "../assembly/path-and-motion";
import { sampleRigidTrajectory } from "../assembly/rigid-trajectory";
import { requirementsInScope, type ContractRequirement, type RequirementContract } from "../requirements/requirement-contract";

type Prepared = Awaited<ReturnType<typeof prepareContractAssembly>>;
export interface AssemblyRequirementAssertion {
  id: string;
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
}

const handled = new Set(["distinct-exported-parts", "motion-range-deg", "motion-range-negative-end", "motion-range-positive-end", "diametral-clearance", "axial-retention", "crank-radius", "rod-length"]);
export const hasAssemblyRequirementAssertion = (id: string) => handled.has(id);

const AXIAL_PARALLEL = 1 - 1e-6;
const POSE_TOLERANCE = 1e-6;

const matrixClose = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= POSE_TOLERANCE);

const unitVector = (value: number[]): number[] | null => {
  const length = Math.hypot(...value);
  return Number.isFinite(length) && length > 1e-12 ? value.map((item) => item / length) : null;
};

const sameDirection = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] >= AXIAL_PARALLEL;

function rotationPart(matrix: number[]) {
  return [matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9], matrix[10]];
}

/** A blocked probe may only start at the assembled pose rotated about the
 * declared joint axis within the declared motion range. */
function isWorkingPose(spec: AssemblySpec, connectionId: string, connection: AssemblySpec["connections"][number],
  movingInstanceTransform: number[], start: number[], axisOrigin: number[], axisDirection: number[]) {
  const motion = spec.motions.find((item) => item.inputConnectionId === connectionId);
  const startRotation = rotationPart(start), instanceRotation = rotationPart(movingInstanceTransform);
  const relative = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++)
    relative[row * 3 + column] = startRotation[row * 3] * instanceRotation[column * 3]
      + startRotation[row * 3 + 1] * instanceRotation[column * 3 + 1]
      + startRotation[row * 3 + 2] * instanceRotation[column * 3 + 2];
  const rotatedAxis = [0, 1, 2].map((row) =>
    relative[row * 3] * axisDirection[0] + relative[row * 3 + 1] * axisDirection[1] + relative[row * 3 + 2] * axisDirection[2]);
  if (rotatedAxis.some((value, index) => Math.abs(value - axisDirection[index]) > POSE_TOLERANCE)) return false;
  const cos = Math.max(-1, Math.min(1, (relative[0] + relative[4] + relative[8] - 1) / 2));
  const sin = 0.5 * ((relative[7] - relative[5]) * axisDirection[0]
    + (relative[2] - relative[6]) * axisDirection[1] + (relative[3] - relative[1]) * axisDirection[2]);
  const angleDeg = Math.atan2(sin, cos) * 180 / Math.PI;
  const range = motion?.range;
  if (range) {
    if (range.unit !== "deg" || angleDeg < range.min - 1e-3 || angleDeg > range.max + 1e-3) return false;
  } else if (Math.abs(angleDeg) > 1e-3) return false;
  const expected = multiplyMatrices(rotationAboutAxis(axisOrigin as [number, number, number],
    axisDirection as [number, number, number], angleDeg * Math.PI / 180), movingInstanceTransform);
  return matrixClose(expected, start);
}

/** The release pose must come from the candidate's own declared disassembly,
 * so a clear probe cannot be fabricated at an unrelated location. */
function disassemblyRelease(input: AssemblySpec, instanceId: string): { poses: number[][]; withdrawal: number[]; operationId: string } | null {
  const operation = input.operations.find((item) => item.action === "disassemble" && item.instanceId === instanceId);
  const instance = input.instances.find((item) => item.id === instanceId);
  if (!operation || !instance) return null;
  if (operation.rigidTrajectory) {
    let poses: number[][];
    try {
      poses = sampleRigidTrajectory({ assembledPose: instance.transform, trajectory: operation.rigidTrajectory,
        maxTranslationStepMm: 0.25, maxRotationStepDeg: 5.001 }).poses;
    } catch { return null; }
    const stages = operation.rigidTrajectory.stages;
    for (let index = stages.length - 1; index >= 0; index--) {
      const stage = stages[index];
      if (stage.type === "translate") {
        const candidates = unitVector(stage.deltaMm);
        if (candidates) {
          // A reverse traversal walks the declared stages backwards; the
          // withdrawal direction is the opposite of the forward translation.
          const withdrawal = operation.rigidTrajectory.traversal === "reverse"
            ? candidates.map((value) => -value) : candidates;
          return { poses, withdrawal, operationId: operation.id };
        }
      }
    }
    return null;
  }
  if (operation.waypoints.length >= 2) {
    const first = operation.waypoints[0], last = operation.waypoints[operation.waypoints.length - 1];
    const withdrawal = unitVector([last[3] - first[3], last[7] - first[7], last[11] - first[11]]);
    if (withdrawal) return { poses: operation.waypoints, withdrawal, operationId: operation.id };
  }
  return null;
}

const directionLabel = (direction: number[]) => `[${direction.map((value) => value.toFixed(3)).join(", ")}]`;

/**
 * Axial retention is measured only by the candidate's own declared rigid
 * translation experiments. When independent disassembly is required, a blocked
 * probe must start at a working pose along the declared withdrawal direction and
 * a clear probe must start at a pose from the declared disassembly trajectory.
 * When no independent release is requested, blocked probes must cover both axial
 * directions at working poses. Every axial probe must pass. This is
 * declared-geometry evidence, not holding force, accidental-unlocking coverage,
 * blocking-obstacle identity or continuous clearance.
 */
function assessAxialRetention(requirement: ContractRequirement, spec: AssemblySpec, prepared: Prepared, contract: RequirementContract): AssemblyRequirementAssertion {
  const result = (status: AssemblyRequirementAssertion["status"], reason: string) => ({ id: requirement.id, status, reason });
  if (requirement.expected.kind !== "equals" || requirement.expected.value !== true)
    return result("NOT_RUN", "Axial retention is only supported as a required true condition.");
  if (prepared.manifest.contract?.evidenceCurrent !== true)
    return result("NOT_RUN", `Axial retention requires a confirmed requirement contract; the manifest records ${String(prepared.manifest.contract?.evidenceCurrent)}.`);
  const revolutes = spec.connections.filter((connection) => connection.type === "revolute");
  if (revolutes.length !== 1)
    return result("NOT_RUN", "Axial retention requires exactly one declared revolute connection to define the joint axis.");
  const connection = revolutes[0];
  if (!connection.frameA)
    return result("NOT_RUN", "The declared revolute joint has no frameA axis; the axial direction cannot be established.");
  const axisInstance = spec.instances.find((instance) => instance.id === connection.a);
  if (!axisInstance) return result("NOT_RUN", "The joint's first instance is unavailable.");
  const direction = connection.frameA.direction;
  const instanceMatrix = axisInstance.transform;
  const axisDirection = unitVector([0, 1, 2].map((row) =>
    instanceMatrix[row * 4] * direction[0] + instanceMatrix[row * 4 + 1] * direction[1] + instanceMatrix[row * 4 + 2] * direction[2]));
  if (!axisDirection) return result("NOT_RUN", "The declared joint axis has no usable direction.");
  const axisOrigin = [0, 1, 2].map((row) =>
    instanceMatrix[row * 4] * connection.frameA!.origin[0] + instanceMatrix[row * 4 + 1] * connection.frameA!.origin[1]
    + instanceMatrix[row * 4 + 2] * connection.frameA!.origin[2] + instanceMatrix[row * 4 + 3]);
  const declarations = spec.translationProbes ?? [];
  if (!declarations.length)
    return result("NOT_RUN", "No declared translation probe exists; axial retention was not measured.");
  const resultsById = new Map((prepared.manifest.translationProbes?.results ?? []).map((item) => [item.id, item]));
  const axial = declarations.map((declaration) => {
    const translated = unitVector(declaration.translationMm);
    return { declaration, measurement: resultsById.get(declaration.id),
      direction: translated,
      axial: !!translated && Math.abs(translated[0] * axisDirection[0] + translated[1] * axisDirection[1] + translated[2] * axisDirection[2]) >= AXIAL_PARALLEL };
  }).filter((row) => row.axial);
  if (!axial.length)
    return result("NOT_RUN", "No declared translation probe moves along the joint axis; the retention direction is not measured.");
  const movingIds = [...new Set(axial.map((row) => row.declaration.instanceId))];
  if (movingIds.length !== 1)
    return result("NOT_RUN", "All axial retention probes must move one joint instance; the declaration mixes moving bodies.");
  const movingInstance = spec.instances.find((instance) => instance.id === movingIds[0]);
  if (!movingInstance || (movingInstance.id !== connection.a && movingInstance.id !== connection.b))
    return result("NOT_RUN", "An axial retention probe moves an instance that is not part of the declared joint.");
  const failed = axial.find((row) => row.measurement?.status === "FAIL");
  if (failed) return result("FAIL", `Declared axial probe ${failed.declaration.id} failed: ${failed.measurement!.reason}`);
  const errored = axial.find((row) => row.measurement?.status === "ERROR");
  if (errored) return result("ERROR", `Declared axial probe ${errored.declaration.id} could not be evaluated: ${errored.measurement!.reason}`);
  const missing = axial.filter((row) => !row.measurement);
  if (missing.length)
    return result("NOT_RUN", `Declared axial probe(s) ${missing.map((row) => row.declaration.id).join(", ")} have no measurement; an unmeasured experiment cannot pass.`);
  const unavailable = axial.find((row) => row.measurement!.status !== "PASS");
  if (unavailable) return result("NOT_RUN", `Declared axial probe ${unavailable.declaration.id} is not available: ${unavailable.measurement!.reason}`);
  const blocked = axial.filter((row) => row.declaration.expected === "blocked");
  const clear = axial.filter((row) => row.declaration.expected === "clear");
  const workingBlocked = blocked.filter((row) => isWorkingPose(spec, connection.id, connection,
    movingInstance.transform, row.declaration.startTransform, axisOrigin, axisDirection));
  const disassemblyRequired = requirementsInScope(contract).some((item) =>
    item.id === "disassembly-path" && item.required && item.applicable);
  if (disassemblyRequired) {
    const release = disassemblyRelease(spec, movingInstance.id);
    if (!release)
      return result("NOT_RUN", "Independent disassembly is required but no declared disassembly trajectory could be sampled to bind the release pose.");
    const withdrawalBlocked = workingBlocked.filter((row) => row.direction && sameDirection(row.direction, release.withdrawal));
    if (!withdrawalBlocked.length)
      return result("NOT_RUN", `No blocked probe at a declared working pose follows the declared withdrawal direction ${directionLabel(release.withdrawal)}; retention against that withdrawal is not measured.`);
    const releasedClear = clear.filter((row) => {
      if (!row.direction || !sameDirection(row.direction, release.withdrawal)) return false;
      return release.poses.some((pose) => matrixClose(pose, row.declaration.startTransform));
    });
    if (!releasedClear.length)
      return result("NOT_RUN", "No clear probe starts at a declared disassembly pose along the withdrawal direction; independent release is not measured.");
    return result("PASS", `${withdrawalBlocked.length} blocked working-pose probe(s) and ${releasedClear.length} clear disassembly-pose probe(s) passed along the declared withdrawal direction ${directionLabel(release.withdrawal)}. This is declared-geometry evidence only: holding force, accidental unlocking, blocking-obstacle identity, continuous clearance, wear and physical function remain unverified.`);
  }
  const positive = workingBlocked.some((row) => row.direction && sameDirection(row.direction, axisDirection));
  const negative = workingBlocked.some((row) => row.direction && sameDirection(row.direction, axisDirection.map((value) => -value)));
  if (!positive || !negative)
    return result("NOT_RUN", "No independent release is requested, so a blocked probe at a declared working pose is required in both axial directions; retention is not measured.");
  return result("PASS", `${workingBlocked.length} blocked working-pose probe(s) cover both axial directions. This is declared-geometry evidence only: holding force, accidental unlocking, blocking-obstacle identity, continuous clearance, wear and physical function remain unverified.`);
}

/** Compare only observations produced for this candidate with the frozen requirement. */
export function assessAssemblyRequirements(contract: RequirementContract, spec: AssemblySpec, prepared: Prepared): AssemblyRequirementAssertion[] {
  const evidence = prepared.manifest.evidence;
  const compare = (requirement: ContractRequirement): AssemblyRequirementAssertion => {
    const result = (status: AssemblyRequirementAssertion["status"], reason: string) => ({ id: requirement.id, status, reason });
    if (requirement.id === "axial-retention") return assessAxialRetention(requirement, spec, prepared, contract);
    if (requirement.id === "crank-radius" || requirement.id === "rod-length") {
      if (requirement.expected.kind !== "range" || requirement.expected.unit !== "mm")
        return result("NOT_RUN", "Mechanism dimensions are compared as a bounded millimetre range only.");
      const dimensions = (prepared.manifest as { mechanismDimensions?: import("../assembly/slider-crank-dimensions").SliderCrankDimensions }).mechanismDimensions;
      if (!dimensions) return result("NOT_RUN", "No slider-crank dimension measurement was captured for this candidate.");
      if (dimensions.status === "ERROR") return result("ERROR", dimensions.reason);
      if (dimensions.status !== "MEASURED") return result("NOT_RUN", dimensions.reason);
      const value = requirement.id === "crank-radius" ? dimensions.crankRadiusMm : dimensions.rodLengthMm;
      if (value === null || !Number.isFinite(value)) return result("ERROR", "The measured mechanism dimension is missing or not finite.");
      const { min, max } = requirement.expected;
      if (value < min || value > max)
        return result("FAIL", `Measured ${requirement.id} ${value.toFixed(6)} mm is outside the requested digital band ${min}–${max} mm. ${dimensions.coverage}`);
      return result("PASS", `Measured ${requirement.id} ${value.toFixed(6)} mm within the requested digital band ${min}–${max} mm. The band is a mesh-resolution band from the request; manufacturing tolerance remains unverified. ${dimensions.coverage}`);
    }
    if (requirement.id === "distinct-exported-parts") {
      if (requirement.expected.kind !== "equals" || typeof requirement.expected.value !== "number"
          || !Number.isInteger(requirement.expected.value) || requirement.expected.value < 1)
        return result("ERROR", "The requested number of distinct exports is invalid.");
      if (!Array.isArray(prepared.parts)) return result("NOT_RUN", "Part exports were not captured.");
      const count = prepared.parts.length, expected = requirement.expected.value;
      if (count < expected) return result("FAIL", `Only ${count} generated part designs were exported; ${expected} distinct exports were requested.`);
      if (evidence.identity.status !== "PASS") return result("NOT_RUN", `Cannot establish ${count} distinct exported designs: ${evidence.identity.reason}`);
      if (count !== expected) return result("FAIL", `${count} distinct part designs were exported; the frozen requirement is ${expected}.`);
      return result("PASS", `${count} selected part designs produced distinct contained meshes. Their intended identity and manufacturing quality remain unverified.`);
    }
    if (requirement.id === "diametral-clearance") {
      if (requirement.expected.kind !== "range" || requirement.expected.unit !== "mm")
        return result("NOT_RUN", "The fit checker supports a bounded diametral clearance in millimetres only.");
      const revolutes = spec.connections.filter(connection => connection.type === "revolute");
      if (!revolutes.length) return result("NOT_RUN", "A declared revolute connection is required for this fit check.");
      const fits = prepared.fits.filter(fit => revolutes.some(connection => connection.id === fit.connectionId));
      if (!fits.length) return result("NOT_RUN", "No measured revolute fit is available for this clearance comparison.");
      // A crank-slider request states one clearance band for the mechanism; the
      // extraction records that it applies to every measurable revolute fit.
      // Unmeasured joints stay visible through the jointFrames layer.
      const wanted = requirement.expected;
      let measuredCount = 0;
      for (const fit of fits) {
        if (fit.status !== "PASS") return result(fit.status, fit.reason);
        const measured = fit.diametralClearanceMm;
        if (fit.measuredStatus !== "PASS" || !measured || !Number.isFinite(measured.min) || !Number.isFinite(measured.max)
            || measured.min > measured.max || !fit.stationsMm.length || fit.stationsMm.some(station => !Number.isFinite(station)))
          return result("ERROR", "A passing fit record has no valid measured interval and stations.");
        if (measured.max < wanted.min || measured.min > wanted.max)
          return result("FAIL", `Measured diametral clearance ${measured.min}–${measured.max} mm at ${fit.connectionId} is outside ${wanted.min}–${wanted.max} mm.`);
        if (measured.min < wanted.min || measured.max > wanted.max)
          return result("ERROR", `Measured clearance ${measured.min}–${measured.max} mm at ${fit.connectionId} crosses the requested band ${wanted.min}–${wanted.max} mm.`);
        measuredCount++;
      }
      return result("PASS", `Measured ${measuredCount} revolute fit(s) within ${wanted.min}–${wanted.max} mm; unsampled geometry and manufacturing remain unverified.`);
    }
    if (requirement.expected.kind !== "atLeast" || requirement.expected.unit !== "deg")
      return result("NOT_RUN", "The motion coverage checker supports degree lower bounds only.");
    const motion = prepared.kinematics?.motion;
    const sliderRigid = (prepared.manifest as { sliderRigidMotion?: { status: string; rangeDeg?: { min: number; max: number } | null } }).sliderRigidMotion;
    const rangeDeg = motion?.rangeDeg ?? sliderRigid?.rangeDeg ?? null;
    const rigidPassed = motion?.status === "PASS" || sliderRigid?.status === "PASS";
    if (evidence.motion.status !== "PASS" || evidence.sourceMotion?.status !== "PASS" || !rigidPassed || !rangeDeg)
      return result("NOT_RUN", `Requested range needs both source-driven pose and ideal rigid-pose evidence: ${evidence.motion.reason}`);
    const { min, max } = rangeDeg;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
      return result("ERROR", "The measured motion interval is invalid.");
    const value = requirement.id === "motion-range-negative-end" ? -min
      : requirement.id === "motion-range-positive-end" ? max : Math.max(Math.abs(min), Math.abs(max));
    const detail = `Ideal rigid-pose samples cover ${min}° to ${max}°; ${requirement.id} requires at least ${requirement.expected.min}°.`;
    return value >= requirement.expected.min
      ? result("PASS", `${detail} Listed source inputs also matched expected poses. Continuous clearance and physical stops remain unverified.`)
      : result("FAIL", `${detail} The declared sampled interval is too short; this does not prove a physical stop.`);
  };
  return requirementsInScope(contract).filter(requirement => requirement.required && requirement.applicable && handled.has(requirement.id)).map(compare);
}
