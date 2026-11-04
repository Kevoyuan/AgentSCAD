/**
 * Measures a cylindrical feature (a bore or a shaft) from an actual mesh along
 * a declared axis. The declared axis is only a seed: the measured centre is
 * refined from the geometry, and a seed that does not lie in a void (bore) or
 * in material (shaft) produces an error rather than a plausible number.
 *
 * A tessellated cylinder is a regular polygon. The measured diameters are
 * therefore an interval: the inscribed diameter is the largest pin that always
 * passes, the circumscribed diameter is the smallest bore that always clears.
 * Reporting one nominal number would hide that.
 */
import {
  analyzeProfile,
  extentAlongAxis,
  normalize,
  planeBasis,
  readBinaryStl,
  refineProfileCenter,
  sectionMesh,
  type TriangleMesh,
  type Vec3,
} from "./stl-mesh";

export type FeatureRole = "bore" | "shaft";

export interface FeatureStation {
  offsetMm: number;
  center: [number, number];
  radiusMinMm: number;
  radiusMaxMm: number;
  segmentCount: number | null;
  formErrorMm: number;
  cylindrical: boolean;
  note: string;
}

export interface CylindricalFeatureMeasurement {
  status: "MEASURED" | "ERROR";
  reason: string;
  role: FeatureRole;
  /** Diametral bounds over all stations; min is the inscribed, max the circumscribed diameter. */
  diameterMm: { min: number; max: number } | null;
  segmentCount: number | null;
  maxFormErrorMm: number | null;
  stations: FeatureStation[];
  /** Measured axis in mesh coordinates, fitted through the station centres. */
  axis: { point: Vec3; direction: Vec3; lateralDeviationMm: number } | null;
  /** Declared inputs that the measurement depends on. */
  assumptions: string[];
}

const DEFAULT_RAYS = 1440;
const DEFAULT_MAX_RADIUS_MM = 50;

export function measureCylindricalFeature(input: {
  stl: Buffer;
  axis: { origin: Vec3; direction: Vec3 };
  role: FeatureRole;
  /** Axial offsets from the axis origin. Defaults to 25/50/75% of the mesh extent. */
  stationsMm?: number[];
  rays?: number;
  maxRadiusMm?: number;
}): CylindricalFeatureMeasurement {
  const assumptions = [
    "The declared axis seeds the search; the measured centre is refined from the mesh.",
    `The feature is treated as a ${input.role}; the mesh cannot tell a bore from a shaft.`,
    "Diameters are the inscribed and circumscribed bounds of the tessellated polygon, not a nominal size.",
  ];
  let mesh: TriangleMesh;
  let direction: Vec3;
  try {
    mesh = readBinaryStl(input.stl);
    direction = normalize(input.axis.direction);
  } catch (error) {
    return { status: "ERROR", reason: error instanceof Error ? error.message : "Invalid mesh or axis", role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations: [], axis: null, assumptions };
  }

  const extent = extentAlongAxis(mesh, input.axis.origin, direction);
  if (!(extent.max > extent.min)) {
    return { status: "ERROR", reason: "The mesh has no extent along the declared axis.", role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations: [], axis: null, assumptions };
  }
  const offsets = input.stationsMm ?? [0.25, 0.5, 0.75].map((fraction) => extent.min + (extent.max - extent.min) * fraction);
  if (offsets.length < 1 || offsets.length > 16) {
    return { status: "ERROR", reason: "Expected 1 to 16 measurement stations.", role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations: [], axis: null, assumptions };
  }
  for (let i = 0; i < offsets.length; i++) {
    if (!Number.isFinite(offsets[i]) || offsets[i] < extent.min || offsets[i] > extent.max) {
      return { status: "ERROR", reason: `Station ${offsets[i]} mm is outside the mesh extent ${extent.min.toFixed(3)}–${extent.max.toFixed(3)} mm along the axis.`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations: [], axis: null, assumptions };
    }
    if (i > 0 && offsets[i] <= offsets[i - 1]) {
      return { status: "ERROR", reason: "Measurement stations must be strictly increasing.", role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations: [], axis: null, assumptions };
    }
  }

  const rays = input.rays ?? DEFAULT_RAYS;
  const maxRadiusMm = input.maxRadiusMm ?? DEFAULT_MAX_RADIUS_MM;
  const { u, v } = planeBasis(direction);
  const stations: FeatureStation[] = [];
  const centres: Vec3[] = [];
  let radiusMin = Infinity, radiusMax = -Infinity;
  let segmentCount: number | null = null;
  let maxFormError = 0;

  for (const offset of offsets) {
    const planeOrigin: Vec3 = [
      input.axis.origin[0] + direction[0] * offset,
      input.axis.origin[1] + direction[1] * offset,
      input.axis.origin[2] + direction[2] * offset,
    ];
    const section = sectionMesh(mesh, planeOrigin, direction);
    if (section.segments.length < 3) {
      return { status: "ERROR", reason: `Station ${offset.toFixed(3)} mm cut ${section.segments.length} segments, so the section is not a closed profile.`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations, axis: null, assumptions };
    }
    const { profile, converged } = refineProfileCenter(section, [0, 0], rays, maxRadiusMm);
    const shape = analyzeProfile(profile);
    if (!shape.cylindrical) {
      return { status: "ERROR", reason: `Station ${offset.toFixed(3)} mm is not a cylindrical section. ${shape.reason}`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations, axis: null, assumptions };
    }
    if (!converged) {
      return { status: "ERROR", reason: `Station ${offset.toFixed(3)} mm did not converge on a feature centre.`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations, axis: null, assumptions };
    }
    stations.push({
      offsetMm: offset,
      center: profile.center,
      radiusMinMm: shape.radiusMinMm,
      radiusMaxMm: shape.radiusMaxMm,
      segmentCount: shape.segmentCount,
      formErrorMm: shape.formErrorMm,
      cylindrical: true,
      note: shape.reason,
    });
    if (shape.radiusMinMm < radiusMin) radiusMin = shape.radiusMinMm;
    if (shape.radiusMaxMm > radiusMax) radiusMax = shape.radiusMaxMm;
    if (shape.formErrorMm > maxFormError) maxFormError = shape.formErrorMm;
    if (shape.segmentCount !== null) {
      if (segmentCount !== null && segmentCount !== shape.segmentCount) {
        return { status: "ERROR", reason: `Stations disagree on the facet count (${segmentCount} vs ${shape.segmentCount}), so the feature is not one cylinder.`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations, axis: null, assumptions };
      }
      segmentCount = shape.segmentCount;
    }
    centres.push([
      planeOrigin[0] + u[0] * profile.center[0] + v[0] * profile.center[1],
      planeOrigin[1] + u[1] * profile.center[0] + v[1] * profile.center[1],
      planeOrigin[2] + u[2] * profile.center[0] + v[2] * profile.center[1],
    ]);
  }

  // One cylinder has the same diameter at every station. Without this, a step
  // or a draft would be reported as a wide but plausible diameter interval.
  const diameterTolerance = Math.max(1e-3, radiusMax * 1e-4);
  const spreadMax = Math.max(...stations.map((station) => station.radiusMaxMm)) - Math.min(...stations.map((station) => station.radiusMaxMm));
  const spreadMin = Math.max(...stations.map((station) => station.radiusMinMm)) - Math.min(...stations.map((station) => station.radiusMinMm));
  if (spreadMax > diameterTolerance || spreadMin > diameterTolerance) {
    return { status: "ERROR", reason: `Stations disagree on the diameter by up to ${Math.max(spreadMax, spreadMin).toFixed(4)} mm, so the feature is not one cylinder.`, role: input.role, diameterMm: null, segmentCount: null, maxFormErrorMm: null, stations, axis: null, assumptions };
  }

  let axis: CylindricalFeatureMeasurement["axis"] = null;
  if (centres.length >= 2) {
    const first = centres[0];
    const last = centres[centres.length - 1];
    const fitted = normalize([last[0] - first[0], last[1] - first[1], last[2] - first[2]]);
    let deviation = 0;
    for (const centre of centres) {
      const delta = [centre[0] - first[0], centre[1] - first[1], centre[2] - first[2]];
      const along = delta[0] * fitted[0] + delta[1] * fitted[1] + delta[2] * fitted[2];
      const perpendicular = Math.hypot(delta[0] - fitted[0] * along, delta[1] - fitted[1] * along, delta[2] - fitted[2] * along);
      if (perpendicular > deviation) deviation = perpendicular;
    }
    axis = { point: first, direction: fitted, lateralDeviationMm: deviation };
  }

  return {
    status: "MEASURED",
    reason: `Measured ${stations.length} section(s) along the declared axis.`,
    role: input.role,
    diameterMm: { min: radiusMin * 2, max: radiusMax * 2 },
    segmentCount,
    maxFormErrorMm: maxFormError,
    stations,
    axis,
    assumptions,
  };
}
