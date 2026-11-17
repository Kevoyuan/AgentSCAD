import type { Vec3 } from "../geometry/stl-mesh";
import type { AssemblySpec } from "./assembly-spec";
import { automaticSliderCrankKinematics } from "./automatic-slider-crank";
import { measureCylindricalFeature } from "../geometry/cylindrical-feature";

/**
 * Measures a canonical slider-crank's crank radius and rod length from the
 * rendered part meshes. The crank pin is a shaft on the crank; the two rod
 * journals are bores. Each feature is measured along its declared connection
 * frame at the first station family the mesh can support. This is a digital
 * mesh measurement, not a manufacturing tolerance or functional claim.
 */
export interface SliderCrankDimensions {
  status: "MEASURED" | "NOT_RUN" | "ERROR";
  crankRadiusMm: number | null;
  rodLengthMm: number | null;
  crankPinRadiusMm: { min: number; max: number } | null;
  rodBoreRadiusMm: { min: number; max: number } | null;
  reason: string;
  coverage: string;
  assumptions: string[];
}

const STATION_FAMILIES: number[][] = [
  [0.5, 1, 1.5], [-0.5, 0, 0.5], [0, 0.5, 1], [-1, 0, 1],
  [1, 2, 3], [0.5, 1, 2], [1.5, 2.5, 3.5], [2, 3, 4], [3, 4, 5], [0, 1, 2],
  [4, 5, 6], [5, 6, 7], [6, 7, 8],
];
const identityAssumptions = [
  "The declared connection frames seed the section search; the measured centres are refined from mesh vertices.",
  "Only the listed station families are covered; the whole feature length is not certified.",
  "Crank radius and rod length are centre distances on a tessellated mesh, not manufacturing tolerances.",
];

function frameFor(connection: AssemblySpec["connections"][number], instanceId: string) {
  return connection.a === instanceId ? connection.frameA : connection.frameB;
}

function featureCenter(input: { stl: Buffer; origin: Vec3; direction: Vec3; role: "shaft" | "bore"; maxRadiusMm: number }) {
  let lastReason = "No station family could be measured.";
  for (const stations of STATION_FAMILIES) {
    const measurement = measureCylindricalFeature({
      stl: input.stl, axis: { origin: input.origin, direction: input.direction },
      role: input.role, stationsMm: stations, maxRadiusMm: input.maxRadiusMm,
    });
    if (measurement.status === "MEASURED" && measurement.axis) {
      return { status: "MEASURED" as const, point: measurement.axis.point,
        radius: { min: measurement.diameterMm!.min / 2, max: measurement.diameterMm!.max / 2 },
        stations, measurement };
    }
    lastReason = measurement.reason;
  }
  return { status: "ERROR" as const, reason: lastReason };
}

export function measureSliderCrankDimensions(input: { spec: AssemblySpec; meshes: Record<string, Buffer> }): SliderCrankDimensions {
  const base: SliderCrankDimensions = {
    status: "NOT_RUN", crankRadiusMm: null, rodLengthMm: null,
    crankPinRadiusMm: null, rodBoreRadiusMm: null, reason: "", coverage: "", assumptions: identityAssumptions,
  };
  const kinematics = automaticSliderCrankKinematics(input.spec);
  if (!kinematics) return { ...base, status: "NOT_RUN", reason: "The assembly is not a recognized four-instance slider-crank." };
  const instance = (id: string) => input.spec.instances.find((item) => item.id === id);
  const partMesh = (instanceId: string) => {
    const item = instance(instanceId);
    const part = item && input.spec.parts.find((entry) => entry.id === item.partId);
    return part && input.meshes[part.id] ? { part, stl: input.meshes[part.id] } : null;
  };
  const byId = (id: string) => input.spec.connections.find((connection) => connection.id === id)!;
  const crank = partMesh(kinematics.crankInstanceId);
  const rod = partMesh(kinematics.rodInstanceId);
  const crankFrame = instance(kinematics.crankInstanceId);
  const rodFrame = instance(kinematics.rodInstanceId);
  if (!crank || !rod || !crankFrame || !rodFrame) return { ...base, reason: "A generated crank or rod mesh is unavailable." };
  const crankAxis = byId(kinematics.crankAxisConnectionId);
  const crankPin = byId(kinematics.crankPinConnectionId);
  const wrist = byId(kinematics.wristConnectionId);
  const axisFrame = frameFor(crankAxis, crankFrame.id);
  const pinFrame = frameFor(crankPin, crankFrame.id);
  const rodPinFrame = frameFor(crankPin, rodFrame.id);
  const rodWristFrame = frameFor(wrist, rodFrame.id);
  if (!axisFrame || !pinFrame || !rodPinFrame || !rodWristFrame)
    return { ...base, status: "ERROR", reason: "The declared slider-crank connections do not carry the frames this measurement needs." };
  const shaft = featureCenter({ stl: crank.stl, origin: pinFrame.origin, direction: pinFrame.direction, role: "shaft", maxRadiusMm: 4 });
  if (shaft.status !== "MEASURED") return { ...base, status: "ERROR", reason: `Crank pin could not be measured: ${shaft.reason}` };
  const boreA = featureCenter({ stl: rod.stl, origin: rodPinFrame.origin, direction: rodPinFrame.direction, role: "bore", maxRadiusMm: 4 });
  if (boreA.status !== "MEASURED") return { ...base, status: "ERROR", reason: `Rod journal A could not be measured: ${boreA.reason}` };
  // A piston-crank can end in an exposed wrist pin instead of a rod bore. The
  // centre distance is the same measurement; try the bore role first, then the
  // shaft role over the same declared station families.
  const boreB = featureCenter({ stl: rod.stl, origin: rodWristFrame.origin, direction: rodWristFrame.direction, role: "bore", maxRadiusMm: 4 });
  const wristB = boreB.status === "MEASURED"
    ? boreB
    : featureCenter({ stl: rod.stl, origin: rodWristFrame.origin, direction: rodWristFrame.direction, role: "shaft", maxRadiusMm: 4 });
  if (wristB.status !== "MEASURED") return { ...base, status: "ERROR", reason: `Rod journal B could not be measured: ${wristB.reason}` };
  const pin = shaft.point;
  const axisOrigin = axisFrame.origin;
  const axisDirection = axisFrame.direction;
  const axisLength = Math.hypot(...axisDirection);
  if (!(axisLength > 0)) return { ...base, status: "ERROR", reason: "The crank axis has no usable direction." };
  const unit = axisDirection.map((value) => value / axisLength) as Vec3;
  // Pin axes can be offset along their own axis (different instance poses and
  // frame origins). The mechanism dimension is the distance in the plane
  // perpendicular to the pin axis, not the raw centre-to-centre distance.
  const planarDistance = (a: Vec3, b: Vec3) => {
    const delta = a.map((value, index) => value - b[index]) as Vec3;
    const along = delta[0] * unit[0] + delta[1] * unit[1] + delta[2] * unit[2];
    return Math.hypot(delta[0] - along * unit[0], delta[1] - along * unit[1], delta[2] - along * unit[2]);
  };
  const delta = pin.map((value, index) => value - axisOrigin[index]) as Vec3;
  const axial = delta[0] * unit[0] + delta[1] * unit[1] + delta[2] * unit[2];
  const perpendicular = delta.map((value, index) => value - axial * unit[index]) as Vec3;
  const radius = Math.hypot(...perpendicular);
  const rodLength = planarDistance(boreA.point, wristB.point);
  if (!Number.isFinite(radius) || !(radius > 1e-6) || !Number.isFinite(rodLength) || !(rodLength > 1e-6))
    return { ...base, status: "ERROR", reason: "Measured radius or rod length is invalid." };
  return {
    ...base, status: "MEASURED",
    crankRadiusMm: radius, rodLengthMm: rodLength,
    crankPinRadiusMm: shaft.radius, rodBoreRadiusMm: boreA.radius,
    reason: `Measured crank radius ${radius.toFixed(6)} mm and rod length ${rodLength.toFixed(6)} mm from mesh sections.`,
    coverage: `Crank pin ${shaft.stations.join("/")} mm and rod journals ${boreA.stations.join("/")} mm and ${wristB.stations.join("/")} mm along their declared frames; one station family per feature.`,
  };
}
