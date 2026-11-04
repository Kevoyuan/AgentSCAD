/**
 * Measures a declared revolute joint against the actual part meshes.
 *
 * This is deliberately split into measurement and assessment. Measurement
 * reports what the geometry is; assessment compares it with a frozen
 * requirement. Neither one proves that the parts are the intended parts, that
 * the joint can be assembled, or that it works when printed.
 */
import { validateAssemblySpec } from "./assembly-spec";
import { measureCylindricalFeature, type CylindricalFeatureMeasurement } from "../geometry/cylindrical-feature";
import { extentAlongAxis, normalize, readBinaryStl, type Vec3 } from "../geometry/stl-mesh";

export interface FitSide {
  instanceId: string;
  partId: string;
  role: "bore" | "shaft";
  measurement: CylindricalFeatureMeasurement;
  /** Measured axis in assembly coordinates. */
  axisInAssembly: { point: Vec3; direction: Vec3 } | null;
  /** Largest distance between the declared axis and the measured feature centre. */
  seedOffsetMm: number | null;
}

export interface RevoluteFitMeasurement {
  status: "MEASURED" | "ERROR" | "NOT_RUN";
  reason: string;
  connectionId: string;
  bore: FitSide | null;
  shaft: FitSide | null;
  /** Diametral clearance interval implied by the tessellated polygons. */
  clearanceMm: { min: number; max: number } | null;
  /** Alignment of the two measured axes in the assembly frame. */
  axis: { offsetMm: number; angleDeg: number } | null;
  stationsMm: number[];
  unknowns: string[];
}

export interface FitRequirement {
  connectionId: string;
  diametralClearanceMm: { min: number; max: number };
  /** Optional alignment limits. Omitted limits are not asserted, not assumed satisfied. */
  maxAxisOffsetMm?: number;
  maxAxisAngleDeg?: number;
}

export interface FitAssessment {
  status: "PASS" | "FAIL" | "NOT_RUN" | "ERROR";
  reason: string;
  measured: RevoluteFitMeasurement | null;
}

const MAX_MESH_BYTES = 64 * 1024 * 1024;

function applyPoint(matrix: number[], point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

function applyDirection(matrix: number[], direction: Vec3): Vec3 {
  return normalize([
    matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2],
    matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2],
    matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2],
  ]);
}

/**
 * `boreInstanceId` must be supplied: the mesh alone cannot tell a bore from a
 * shaft, and inferring the role from the larger diameter would make every
 * clearance positive by construction.
 */
export function measureRevoluteFit(input: {
  spec: unknown;
  connectionId: string;
  /** Part meshes in part-local coordinates, keyed by part ID. */
  meshes: Record<string, Buffer>;
  boreInstanceId: string;
  stationsMm?: number[];
  rays?: number;
  maxRadiusMm?: number;
}): RevoluteFitMeasurement {
  const unknowns = [
    "The feature role is declared by the caller, not measured from the mesh.",
    "Only the sampled axial stations are measured; other stations are not covered.",
    "Radial clearance is measured, not assembly, motion or physical function.",
  ];
  const base: RevoluteFitMeasurement = { status: "NOT_RUN", reason: "", connectionId: input.connectionId, bore: null, shaft: null, clearanceMm: null, axis: null, stationsMm: [], unknowns };
  const parsed = validateAssemblySpec(input.spec);
  if (!parsed.success) return { ...base, status: "ERROR", reason: "Invalid assembly specification." };
  const spec = parsed.data;
  const connection = spec.connections.find((item) => item.id === input.connectionId);
  if (!connection) return { ...base, status: "ERROR", reason: "Unknown connection." };
  if (connection.type !== "revolute") return { ...base, status: "NOT_RUN", reason: `Connection type "${connection.type}" is not measured by this check.` };
  if (!connection.frameA || !connection.frameB) return { ...base, status: "ERROR", reason: "A revolute joint needs a frame on both instances." };
  if (input.boreInstanceId !== connection.a && input.boreInstanceId !== connection.b) {
    return { ...base, status: "ERROR", reason: "The bore instance must be one of the connection's two instances." };
  }

  const instanceA = spec.instances.find((item) => item.id === connection.a);
  const instanceB = spec.instances.find((item) => item.id === connection.b);
  if (!instanceA || !instanceB) return { ...base, status: "ERROR", reason: "Connection refers to a missing instance." };
  const partA = spec.parts.find((item) => item.id === instanceA.partId);
  const partB = spec.parts.find((item) => item.id === instanceB.partId);
  if (!partA || !partB) return { ...base, status: "ERROR", reason: "Instance refers to a missing part." };
  if (partA.source !== "generated" || partB.source !== "generated") {
    return { ...base, status: "NOT_RUN", reason: "A purchased part has no mesh to measure." };
  }
  const meshA = input.meshes[partA.id];
  const meshB = input.meshes[partB.id];
  if (!meshA || !meshB) return { ...base, status: "NOT_RUN", reason: "A part mesh is missing." };
  if (meshA.length > MAX_MESH_BYTES || meshB.length > MAX_MESH_BYTES) return { ...base, status: "ERROR", reason: "A part mesh exceeds the measurement budget." };

  let extentA: { min: number; max: number };
  let extentB: { min: number; max: number };
  let directionA: Vec3;
  let directionB: Vec3;
  let originA: Vec3;
  let originB: Vec3;
  try {
    directionA = applyDirection(instanceA.transform, connection.frameA.direction);
    directionB = applyDirection(instanceB.transform, connection.frameB.direction);
    originA = applyPoint(instanceA.transform, connection.frameA.origin);
    originB = applyPoint(instanceB.transform, connection.frameB.origin);
    extentA = extentAlongAxis(readBinaryStl(meshA), connection.frameA.origin, connection.frameA.direction);
    extentB = extentAlongAxis(readBinaryStl(meshB), connection.frameB.origin, connection.frameB.direction);
  } catch (error) {
    return { ...base, status: "ERROR", reason: error instanceof Error ? error.message : "Invalid part mesh." };
  }

  // The two frames may have different origins, so their local offsets are not
  // comparable. Work in one axis parameter: s along A's assembly direction,
  // starting at A's origin. A point at s has B-local offset c + k*s.
  const parallel = directionA[0] * directionB[0] + directionA[1] * directionB[1] + directionA[2] * directionB[2];
  if (Math.abs(parallel) < Math.cos((10 * Math.PI) / 180)) {
    return { ...base, status: "ERROR", reason: "The declared joint frames differ by more than 10°, so they do not describe one axis." };
  }
  const k = parallel;
  const delta = [originA[0] - originB[0], originA[1] - originB[1], originA[2] - originB[2]];
  const c = delta[0] * directionB[0] + delta[1] * directionB[1] + delta[2] * directionB[2];

  const overlapMin = Math.max(extentA.min, (extentB.min - c) / k);
  const overlapMax = Math.min(extentA.max, (extentB.max - c) / k);
  if (!(overlapMax > overlapMin)) {
    return { ...base, status: "ERROR", reason: "The two features do not overlap along the declared axis, so they cannot form a joint." };
  }
  const stations = input.stationsMm ?? [0.2, 0.5, 0.8].map((fraction) => overlapMin + (overlapMax - overlapMin) * fraction);
  if (stations.some((value) => !Number.isFinite(value) || value < overlapMin || value > overlapMax)) {
    return { ...base, status: "ERROR", reason: "Every station must lie inside the axial overlap of the two features." };
  }
  const stationsA = stations;
  const stationsB = stations.map((value) => c + k * value);

  const measure = (side: typeof instanceA, partId: string, stl: Buffer, frame: { origin: Vec3; direction: Vec3 }, role: "bore" | "shaft", localStations: number[]): FitSide => {
    const measurement = measureCylindricalFeature({ stl, axis: frame, role, stationsMm: localStations, rays: input.rays, maxRadiusMm: input.maxRadiusMm });
    let axisInAssembly: { point: Vec3; direction: Vec3 } | null = null;
    let seedOffsetMm: number | null = null;
    if (measurement.status === "MEASURED" && measurement.axis) {
      axisInAssembly = {
        point: applyPoint(side.transform, measurement.axis.point),
        direction: applyDirection(side.transform, measurement.axis.direction),
      };
      seedOffsetMm = Math.max(...measurement.stations.map((station) => Math.hypot(station.center[0], station.center[1])));
    }
    return { instanceId: side.id, partId, role, measurement, axisInAssembly, seedOffsetMm };
  };

  const boreInstance = input.boreInstanceId === instanceA.id ? instanceA : instanceB;
  const shaftInstance = input.boreInstanceId === instanceA.id ? instanceB : instanceA;
  const boreFrame = input.boreInstanceId === instanceA.id ? connection.frameA : connection.frameB;
  const shaftFrame = input.boreInstanceId === instanceA.id ? connection.frameB : connection.frameA;
  const borePart = input.boreInstanceId === instanceA.id ? partA : partB;
  const shaftPart = input.boreInstanceId === instanceA.id ? partB : partA;
  const boreMesh = input.boreInstanceId === instanceA.id ? meshA : meshB;
  const shaftMesh = input.boreInstanceId === instanceA.id ? meshB : meshA;

  const boreStations = input.boreInstanceId === instanceA.id ? stationsA : stationsB;
  const shaftStations = input.boreInstanceId === instanceA.id ? stationsB : stationsA;
  const bore = measure(boreInstance, borePart.id, boreMesh, boreFrame, "bore", boreStations);
  const shaft = measure(shaftInstance, shaftPart.id, shaftMesh, shaftFrame, "shaft", shaftStations);
  if (bore.measurement.status !== "MEASURED") return { ...base, bore, shaft, stationsMm: stations, status: "ERROR", reason: `The bore could not be measured: ${bore.measurement.reason}` };
  if (shaft.measurement.status !== "MEASURED") return { ...base, bore, shaft, stationsMm: stations, status: "ERROR", reason: `The shaft could not be measured: ${shaft.measurement.reason}` };

  const boreDiameter = bore.measurement.diameterMm!;
  const shaftDiameter = shaft.measurement.diameterMm!;
  const clearanceMm = { min: boreDiameter.min - shaftDiameter.max, max: boreDiameter.max - shaftDiameter.min };

  let axis: RevoluteFitMeasurement["axis"] = null;
  if (bore.axisInAssembly && shaft.axisInAssembly) {
    const dot = Math.abs(
      bore.axisInAssembly.direction[0] * shaft.axisInAssembly.direction[0] +
      bore.axisInAssembly.direction[1] * shaft.axisInAssembly.direction[1] +
      bore.axisInAssembly.direction[2] * shaft.axisInAssembly.direction[2],
    );
    const angleDeg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    const delta: Vec3 = [
      bore.axisInAssembly.point[0] - shaft.axisInAssembly.point[0],
      bore.axisInAssembly.point[1] - shaft.axisInAssembly.point[1],
      bore.axisInAssembly.point[2] - shaft.axisInAssembly.point[2],
    ];
    const direction = bore.axisInAssembly.direction;
    const along = delta[0] * direction[0] + delta[1] * direction[1] + delta[2] * direction[2];
    const offsetMm = Math.hypot(delta[0] - direction[0] * along, delta[1] - direction[1] * along, delta[2] - direction[2] * along);
    axis = { offsetMm, angleDeg };
  }

  return {
    status: "MEASURED",
    reason: `Measured ${stations.length} station(s) on each side; clearance is the interval implied by the tessellated polygons.`,
    connectionId: connection.id,
    bore,
    shaft,
    clearanceMm,
    axis,
    stationsMm: stations,
    unknowns,
  };
}

/** Compares a measurement with a frozen requirement. A missing measurement never passes. */
export function assessFit(measurement: RevoluteFitMeasurement | null, requirement: FitRequirement): FitAssessment {
  if (!requirement || typeof requirement.connectionId !== "string") return { status: "ERROR", reason: "The fit requirement is malformed.", measured: measurement };
  const bounds = requirement.diametralClearanceMm;
  if (!bounds || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) || bounds.min > bounds.max) {
    return { status: "ERROR", reason: "The frozen clearance bounds are invalid.", measured: measurement };
  }
  if (!measurement || measurement.status !== "MEASURED" || !measurement.clearanceMm) {
    return { status: measurement?.status === "ERROR" ? "ERROR" : "NOT_RUN", reason: measurement?.reason || "No fit measurement was supplied.", measured: measurement };
  }
  if (measurement.connectionId !== requirement.connectionId) {
    return { status: "ERROR", reason: "The measurement belongs to a different connection.", measured: measurement };
  }
  const { min, max } = measurement.clearanceMm;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { status: "ERROR", reason: "The measured clearance is not finite.", measured: measurement };
  if (max < bounds.min || min > bounds.max) {
    return { status: "FAIL", reason: `The measured diametral clearance ${min.toFixed(3)}–${max.toFixed(3)} mm is outside the frozen ${bounds.min}–${bounds.max} mm band.`, measured: measurement };
  }
  if (min < bounds.min || max > bounds.max) {
    return { status: "ERROR", reason: `The measured diametral clearance ${min.toFixed(3)}–${max.toFixed(3)} mm straddles the frozen ${bounds.min}–${bounds.max} mm band, so the geometry does not decide it.`, measured: measurement };
  }
  if (requirement.maxAxisOffsetMm !== undefined) {
    if (!measurement.axis) return { status: "NOT_RUN", reason: "Axis alignment was required but not measured.", measured: measurement };
    if (!Number.isFinite(requirement.maxAxisOffsetMm) || requirement.maxAxisOffsetMm < 0) return { status: "ERROR", reason: "The axis offset limit is invalid.", measured: measurement };
    if (measurement.axis.offsetMm > requirement.maxAxisOffsetMm) {
      return { status: "FAIL", reason: `The measured axis offset ${measurement.axis.offsetMm.toFixed(3)} mm exceeds the frozen ${requirement.maxAxisOffsetMm} mm limit.`, measured: measurement };
    }
  }
  if (requirement.maxAxisAngleDeg !== undefined) {
    if (!measurement.axis) return { status: "NOT_RUN", reason: "Axis alignment was required but not measured.", measured: measurement };
    if (!Number.isFinite(requirement.maxAxisAngleDeg) || requirement.maxAxisAngleDeg < 0) return { status: "ERROR", reason: "The axis angle limit is invalid.", measured: measurement };
    if (measurement.axis.angleDeg > requirement.maxAxisAngleDeg) {
      return { status: "FAIL", reason: `The measured axis angle ${measurement.axis.angleDeg.toFixed(3)}° exceeds the frozen ${requirement.maxAxisAngleDeg}° limit.`, measured: measurement };
    }
  }
  return {
    status: "PASS",
    reason: `The measured diametral clearance ${min.toFixed(3)}–${max.toFixed(3)} mm is inside the frozen ${bounds.min}–${bounds.max} mm band at the sampled stations. This is a fit result, not an assembly, motion or physical result.`,
    measured: measurement,
  };
}
