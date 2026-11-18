import { createHash } from "node:crypto";
import { measureCylindricalFeature } from "../geometry/cylindrical-feature";
import {
  dot,
  extentAlongAxis,
  meshBounds,
  normalize,
  planeBasis,
  readBinaryStl,
  sectionMesh,
  type MeshSection,
  type TriangleMesh,
  type Vec3,
} from "../geometry/stl-mesh";

export interface GearMarkerMeasurement {
  status: "MEASURED" | "NOT_RUN" | "ERROR";
  angleDeg: number | null;
  vertexCount: number;
  radiusMinMm: number | null;
  radiusMaxMm: number | null;
  coverage: string;
  reason: string;
  artifactSha256: string | null;
}

/**
 * Measures the angular position of a radial index tab with vertices outside the
 * gear addendum circle. This is a rigid-body orientation witness for the listed
 * mesh; it says nothing about tooth contact, backlash or coupling under load.
 */
export function measureGearMarkerAngle(input: {
  stl: Buffer;
  center: [number, number];
  minRadiusMm: number;
  maxRadiusMm: number;
}): GearMarkerMeasurement {
  const base: GearMarkerMeasurement = { status: "NOT_RUN", angleDeg: null, vertexCount: 0,
    radiusMinMm: null, radiusMaxMm: null, coverage: "", reason: "", artifactSha256: null };
  const coverage = `Unique STL vertices with radius ${input.minRadiusMm}–${input.maxRadiusMm} mm about the declared gear centre; tab vertices only.`;
  if (!Number.isFinite(input.minRadiusMm) || !Number.isFinite(input.maxRadiusMm)
      || input.minRadiusMm <= 0 || input.maxRadiusMm <= input.minRadiusMm)
    return { ...base, coverage, status: "ERROR", reason: "Invalid marker radius window." };
  let mesh: ReturnType<typeof readBinaryStl>;
  try { mesh = readBinaryStl(input.stl); } catch (error) {
    return { ...base, coverage, status: "ERROR", reason: error instanceof Error ? error.message : "Invalid mesh." };
  }
  const artifactSha256 = createHash("sha256").update(input.stl).digest("hex");
  if (!mesh.triangleCount) return { ...base, coverage, artifactSha256, status: "ERROR", reason: "Empty mesh." };
  const seen = new Set<string>();
  let cosSum = 0, sinSum = 0, count = 0, radiusMin = Infinity, radiusMax = -Infinity;
  for (let i = 0; i < mesh.coordinates.length; i += 3) {
    const x = mesh.coordinates[i] - input.center[0];
    const y = mesh.coordinates[i + 1] - input.center[1];
    const key = `${mesh.coordinates[i].toFixed(6)},${mesh.coordinates[i + 1].toFixed(6)},${mesh.coordinates[i + 2].toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const radius = Math.hypot(x, y);
    if (radius < input.minRadiusMm || radius > input.maxRadiusMm) continue;
    const angle = Math.atan2(y, x);
    cosSum += Math.cos(angle); sinSum += Math.sin(angle); count++;
    radiusMin = Math.min(radiusMin, radius); radiusMax = Math.max(radiusMax, radius);
  }
  if (count < 4) return { ...base, coverage, artifactSha256, status: "NOT_RUN", reason: `Only ${count} marker vertices were found in the radius window.` };
  const angleDeg = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) % 360 + 360) % 360;
  return { ...base, status: "MEASURED", angleDeg, vertexCount: count,
    radiusMinMm: radiusMin, radiusMaxMm: radiusMax, artifactSha256, coverage,
    reason: `Marker centroid direction ${angleDeg.toFixed(6)}° from ${count} tab vertices.` };
}

const wrap180 = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;

export interface GearProfileMeasurement {
  status: "MEASURED" | "NOT_RUN" | "ERROR";
  /** External teeth point outward; internal teeth point inward from a ring. */
  mode: "external" | "internal";
  artifactSha256: string | null;
  /** Bore-axis intersection with the measured section, in assembly coordinates. */
  centerMm: [number, number] | null;
  /** Whether the section axis and centre came from the mesh bore or from the declaration. */
  axisSource: "bore" | "declared" | null;
  axis: { point: Vec3; direction: Vec3; lateralDeviationMm: number } | null;
  /** Outer addendum radius (external) or inner addendum radius (internal). */
  tipRadiusMm: number | null;
  /** Root radius on the opposite side of the tooth from the tip. */
  rootRadiusMm: number | null;
  /** Standard full-depth estimate (tip − root) / 2.25; an assumption, not a certification. */
  moduleMm: number | null;
  /** Standard full-depth estimate: root + 1.25·module (external) or root − 1.25·module (internal). */
  pitchRadiusMm: number | null;
  toothCount: number | null;
  angularPitchDeg: number | null;
  toothWidthDeg: number | null;
  /** Largest deviation of measured tooth centres from an evenly spaced grid. */
  phaseResidualDeg: number | null;
  marker: {
    angleDeg: number;
    vertexCount: number;
    bandMm: { min: number; max: number };
  } | null;
  coverage: string;
  reason: string;
}

interface ProfileCandidate {
  values: Float64Array;
  misses: number;
}

/**
 * Casts rays from the section centre and records either the farthest (external
 * tooth tips) or nearest (internal ring teeth) boundary. The nearest function
 * in `stl-mesh.ts` cannot be reused because an external gear's outer teeth are
 * behind the bore along the same ray.
 */
function castGearProfile(section: MeshSection, rays: number, maxRadiusMm: number, mode: "external" | "internal"): ProfileCandidate {
  const values = new Float64Array(rays);
  let misses = 0;
  const segments = section.segments;
  for (let ray = 0; ray < rays; ray++) {
    const angle = (2 * Math.PI * ray) / rays;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = mode === "external" ? -Infinity : Infinity;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const ex = segment.bx - segment.ax, ey = segment.by - segment.ay;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) continue;
      // Section segments are already in section coordinates (origin-relative).
      const px = segment.ax, py = segment.ay;
      const t = (px * ey - py * ex) / denominator;
      if (!(t >= 0) || t > maxRadiusMm) continue;
      const u = (px * dy - py * dx) / denominator;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      if (mode === "external" ? t > best : t < best) best = t;
    }
    if (!Number.isFinite(best)) {
      misses++;
      values[ray] = NaN;
    } else {
      values[ray] = best;
    }
  }
  return { values, misses };
}

/**
 * Picks the significant radius on the boundary side being measured: the largest
 * supported radius for an external tooth tip, the smallest for an internal ring
 * tip. A frequency mode cannot do this: a wide root land can have more rays than
 * the narrower addendum, which would invert tip and root. The support threshold
 * also excludes a sparse index marker.
 */
function supportedRadius(values: Float64Array, rays: number, mode: "external" | "internal"): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const bucket = Math.round(value * 50) / 50;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const support = Math.max(3, Math.ceil(rays * 0.10));
  let best: number | null = null;
  for (const [bucket, count] of counts) {
    if (count < support) continue;
    if (best === null || (mode === "external" ? bucket > best : bucket < best)) best = bucket;
  }
  return best;
}

/** Circular runs of a boolean ring; indices are ray indices. */
function circularRuns(flags: boolean[]): Array<{ start: number; length: number }> {
  const length = flags.length;
  const firstFalse = flags.findIndex((flag) => !flag);
  if (firstFalse < 0) return [{ start: 0, length }];
  const runs: Array<{ start: number; length: number }> = [];
  let start = -1;
  for (let offset = 0; offset < length; offset++) {
    const index = (firstFalse + offset) % length;
    if (flags[index]) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push({ start, length: (index - start + length) % length });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, length: (firstFalse - start + length) % length });
  return runs;
}

const angleOf = (index: number, rays: number) => (index * 360) / rays;

/**
 * Measures a gear from its actual triangulated section. The centre/axis is
 * seeded by the caller and, for a through-bore, refined from the mesh. Teeth
 * are counted on the outer (or inner) boundary, not read from the source.
 *
 * Boundaries: this is a full-depth, straight-sided tooth estimate. It does not
 * prove involute contact, backlash, load capacity, backlash, axis alignment
 * between two independent parts or physical function.
 */
export function measureGearProfile(input: {
  stl: Buffer;
  mode: "external" | "internal";
  /** Seed centre in assembly coordinates. */
  center: [number, number];
  axisDirection?: Vec3;
  /** Use the through-bore to refine the axis and centre. Defaults to true for external gears. */
  measureAxis?: boolean;
  rays?: number;
  maxRadiusMm?: number;
}): GearProfileMeasurement {
  const base: GearProfileMeasurement = {
    status: "NOT_RUN", mode: input.mode, artifactSha256: null, centerMm: null, axisSource: null, axis: null,
    tipRadiusMm: null, rootRadiusMm: null, moduleMm: null, pitchRadiusMm: null,
    toothCount: null, angularPitchDeg: null, toothWidthDeg: null, phaseResidualDeg: null,
    marker: null, coverage: "", reason: "",
  };
  const rays = input.rays ?? 1440;
  if (!Number.isSafeInteger(rays) || rays < 180 || rays > 100_000) {
    return { ...base, status: "ERROR", reason: "Ray count must be an integer between 180 and 100000." };
  }
  const seedDirection = normalize(input.axisDirection ?? [0, 0, 1]);
  let mesh: TriangleMesh;
  try {
    mesh = readBinaryStl(input.stl);
  } catch (error) {
    return { ...base, status: "ERROR", reason: error instanceof Error ? error.message : "Invalid mesh." };
  }
  const artifactSha256 = createHash("sha256").update(input.stl).digest("hex");
  if (!mesh.triangleCount) return { ...base, status: "ERROR", artifactSha256, reason: "Empty mesh." };

  const bounds = meshBounds(mesh);
  const maxExtent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  if (!(maxExtent > 0)) return { ...base, status: "ERROR", artifactSha256, reason: "The mesh has no extent." };

  let direction = seedDirection;
  let axisPoint: Vec3 = [input.center[0], input.center[1], 0];
  let axisSource: "bore" | "declared" = "declared";
  let lateralDeviationMm = 0;
  const shouldMeasureAxis = input.measureAxis ?? input.mode === "external";
  if (shouldMeasureAxis && input.mode === "external") {
    // The bore is the only feature whose axis is measured. A seed outside the
    // bore must fail instead of silently fitting the outer tooth circle.
    const bore = measureCylindricalFeature({
      stl: input.stl,
      axis: { origin: axisPoint, direction: seedDirection },
      role: "bore",
      maxRadiusMm: Math.max(1, maxExtent * 0.2),
      rays,
    });
    if (bore.status === "MEASURED" && bore.axis) {
      direction = normalize(bore.axis.direction);
      // The fitted station order defines the sign; keep it so the marker angle
      // is measured in a consistent right-handed section frame.
      if (dot(direction, seedDirection) < 0) direction = [-direction[0], -direction[1], -direction[2]];
      const extent = extentAlongAxis(mesh, [input.center[0], input.center[1], 0], direction);
      const midOffset = (extent.min + extent.max) / 2;
      const firstOffset = bore.stations[0]?.offsetMm ?? 0;
      axisPoint = [
        bore.axis.point[0] + direction[0] * (midOffset - firstOffset),
        bore.axis.point[1] + direction[1] * (midOffset - firstOffset),
        bore.axis.point[2] + direction[2] * (midOffset - firstOffset),
      ];
      lateralDeviationMm = bore.axis.lateralDeviationMm;
      axisSource = "bore";
    }
  }
  if (!axisPoint.every(Number.isFinite)) return { ...base, artifactSha256, status: "ERROR", reason: "The declared centre is not finite." };

  const section = sectionMesh(mesh, axisPoint, direction);
  if (section.segments.length < 3) {
    return { ...base, artifactSha256, status: "NOT_RUN",
      reason: `The section cut ${section.segments.length} segments, so there is no closed tooth profile.` };
  }
  const maxRadiusMm = input.maxRadiusMm ?? Math.max(1, maxExtent);
  const cast = castGearProfile(section, rays, maxRadiusMm, input.mode);
  if (cast.misses > 0) {
    return { ...base, artifactSha256, centerMm: axisSource === "bore" ? [axisPoint[0], axisPoint[1]] : input.center,
      axisSource, axis: { point: axisPoint, direction, lateralDeviationMm },
      status: "NOT_RUN", reason: `${cast.misses} of ${rays} rays missed the section; the profile is open or the centre is outside the solid.` };
  }

  const finite = Array.from(cast.values).filter(Number.isFinite);
  const extreme = input.mode === "external" ? Math.max(...finite) : Math.min(...finite);
  if (!(extreme > 0)) return { ...base, artifactSha256, status: "ERROR", reason: "The profile has no positive radius." };
  const tip = supportedRadius(cast.values, rays, input.mode);
  if (tip === null || !(tip > 0)) {
    return { ...base, artifactSha256, status: "NOT_RUN", reason: "No dominant tooth-tip radius was found." };
  }
  const root = input.mode === "external" ? Math.min(...finite) : Math.max(...finite);
  if (input.mode === "external" ? !(tip > root) : !(root > tip)) {
    return { ...base, artifactSha256, status: "NOT_RUN", reason: "The measured tip and root radii do not enclose a tooth." };
  }
  const toothHeight = Math.abs(root - tip);
  const tolerance = Math.max(0.08, toothHeight * 0.04);
  const isTip = Array.from(cast.values, (value) => input.mode === "external"
    ? value >= tip - tolerance && value <= tip + tolerance
    : value <= tip + tolerance && value >= tip - tolerance);
  const runs = circularRuns(isTip).filter((run) => run.length >= 2);
  if (runs.length < 3 || runs.length > 1024) {
    return { ...base, artifactSha256, status: "NOT_RUN", reason: `Detected ${runs.length} tooth-tip intervals; at least 3 are required.` };
  }
  const toothCount = runs.length;
  const angularPitchDeg = 360 / toothCount;
  const centres = runs.map((run) => angleOf(run.start, rays) + (run.length * 360) / rays / 2).map((value) => (value + 360) % 360);
  const phaseDeltas = centres.map((centre, index) => centre - index * angularPitchDeg);
  const phase = Math.atan2(phaseDeltas.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0),
    phaseDeltas.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0)) * 180 / Math.PI;
  const phaseResidualDeg = Math.max(...centres.map((centre, index) => Math.abs(wrap180(centre - phase - index * angularPitchDeg))));
  if (phaseResidualDeg > angularPitchDeg / 4) {
    return { ...base, artifactSha256, status: "NOT_RUN",
      reason: `Tooth centres deviate by ${phaseResidualDeg.toFixed(3)}° from an even ${angularPitchDeg.toFixed(3)}° pitch.` };
  }
  const moduleMm = toothHeight / 2.25;
  const pitchRadiusMm = input.mode === "external" ? root + 1.25 * moduleMm : root - 1.25 * moduleMm;

  // The marker is measured from unique section vertices outside the addendum.
  // It is deliberately not derived from the tooth pattern: a gear without an
  // index tab must report NOT_RUN rather than an invented phase.
  const { u, v } = planeBasis(direction);
  const seen = new Set<string>();
  let markerCos = 0, markerSin = 0, markerCount = 0, markerMin = Infinity, markerMax = -Infinity;
  const markerBandMin = tip + Math.max(0.3, toothHeight * 0.1);
  let vertexMaxRadius = 0;
  for (let index = 0; index < mesh.coordinates.length; index += 3) {
    // Deduplicate in 3D, not the section plane: a tab has two corners at the
    // same projected radius, and collapsing them would under-count the marker.
    const key = `${mesh.coordinates[index].toFixed(5)},${mesh.coordinates[index + 1].toFixed(5)},${mesh.coordinates[index + 2].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dx = mesh.coordinates[index] - axisPoint[0];
    const dy = mesh.coordinates[index + 1] - axisPoint[1];
    const dz = mesh.coordinates[index + 2] - axisPoint[2];
    const x = dx * u[0] + dy * u[1] + dz * u[2];
    const y = dx * v[0] + dy * v[1] + dz * v[2];
    const radius = Math.hypot(x, y);
    vertexMaxRadius = Math.max(vertexMaxRadius, radius);
    if (radius < markerBandMin) continue;
    const angle = Math.atan2(y, x);
    markerCos += Math.cos(angle); markerSin += Math.sin(angle); markerCount++;
    markerMin = Math.min(markerMin, radius); markerMax = Math.max(markerMax, radius);
  }
  let marker: GearProfileMeasurement["marker"] = null;
  if (input.mode === "external" && markerCount >= 4) {
    marker = {
      angleDeg: ((Math.atan2(markerSin, markerCos) * 180 / Math.PI) % 360 + 360) % 360,
      vertexCount: markerCount,
      bandMm: { min: markerBandMin, max: Math.max(markerMax, vertexMaxRadius) + 1e-3 },
    };
  }
  const centerMm: [number, number] = [axisPoint[0], axisPoint[1]];
  const coverage = `${input.mode === "external" ? "Outer" : "Inner"} boundary sampled by ${rays} rays; tooth count from contiguous tip intervals, centre/axis ${axisSource === "bore" ? "refined from the through-bore" : "from the declaration"}. ${marker ? `Marker measured from ${marker.vertexCount} vertices above the addendum.` : "No marker vertices above the addendum."}`;
  return {
    status: "MEASURED", mode: input.mode, artifactSha256, centerMm, axisSource,
    axis: { point: axisPoint, direction, lateralDeviationMm },
    tipRadiusMm: tip, rootRadiusMm: root, moduleMm, pitchRadiusMm,
    toothCount, angularPitchDeg, toothWidthDeg: runs.reduce((sum, run) => sum + run.length, 0) / rays * 360 / toothCount,
    phaseResidualDeg, marker, coverage,
    reason: `${toothCount} teeth at ${angularPitchDeg.toFixed(6)}° pitch; module estimate ${moduleMm.toFixed(4)} mm, pitch radius ${pitchRadiusMm.toFixed(4)} mm.`,
  };
}

export interface GearCouplingPose {
  inputDeg: number;
  pinionAngleDeg: number;
  wheelAngleDeg: number;
}

/**
 * Checks a rigid external pair from marker orientation. When the measured
 * profiles are supplied, the tooth-count ratio and the measured centre distance
 * are also required; without them this is a marker-only check and says so.
 */
export function checkGearCoupling(input: {
  poses: GearCouplingPose[];
  pinion?: GearProfileMeasurement;
  wheel?: GearProfileMeasurement;
  expectedRatio: number;
  angleToleranceDeg: number;
  ratioTolerance: number;
  centerDistanceToleranceMm?: number;
}) {
  const { poses, expectedRatio, angleToleranceDeg, ratioTolerance } = input;
  if (poses.length < 3 || poses.some(pose => !Object.values(pose).every(Number.isFinite)))
    throw new Error("Gear coupling needs at least three finite poses.");
  if (!(angleToleranceDeg > 0) || !(ratioTolerance > 0) || !Number.isFinite(expectedRatio))
    throw new Error("Invalid gear coupling tolerances.");

  const measuredProfiles = Boolean(input.pinion && input.wheel);
  const profiles = [input.pinion, input.wheel].filter((profile): profile is GearProfileMeasurement => Boolean(profile));
  if (measuredProfiles && profiles.some(profile => profile.status !== "MEASURED")) {
    return {
      status: "NOT_RUN" as const, measuredRatio: null, expectedRatio, toothRatio: null,
      direction: null, expectedDirection: expectedRatio > 0 ? "same" : "opposite",
      pinionResidualMaxDeg: null, wheelResidualMaxDeg: null, centerDistanceMm: null,
      centerDistanceToleranceMm: input.centerDistanceToleranceMm ?? 0.2,
      coverage: "A measured gear profile was unavailable, so no coupling verdict is claimed.",
      reason: "At least one gear profile is not MEASURED.",
    };
  }
  if (measuredProfiles && (input.pinion!.axisSource !== "bore" || input.wheel!.axisSource !== "bore")) {
    return {
      status: "NOT_RUN" as const, measuredRatio: null, expectedRatio, toothRatio: null,
      direction: null, expectedDirection: expectedRatio > 0 ? "same" : "opposite",
      pinionResidualMaxDeg: null, wheelResidualMaxDeg: null, centerDistanceMm: null,
      centerDistanceToleranceMm: input.centerDistanceToleranceMm ?? 0.2,
      coverage: "The gear axis is required to come from a measured through-bore, not from the declaration.",
      reason: "At least one gear axis is declared rather than measured from a bore.",
    };
  }
  if (measuredProfiles && (!input.pinion!.marker || !input.wheel!.marker)) {
    return {
      status: "NOT_RUN" as const, measuredRatio: null, expectedRatio, toothRatio: null,
      direction: null, expectedDirection: expectedRatio > 0 ? "same" : "opposite",
      pinionResidualMaxDeg: null, wheelResidualMaxDeg: null, centerDistanceMm: null,
      centerDistanceToleranceMm: input.centerDistanceToleranceMm ?? 0.2,
      coverage: "Marker orientation is required to observe the source-driven rotation.",
      reason: "At least one gear has no measured index marker.",
    };
  }

  const toothRatio = measuredProfiles
    ? -input.pinion!.toothCount! / input.wheel!.toothCount!
    : null;
  const targetRatio = toothRatio ?? expectedRatio;
  const first = poses[0];
  const pinionOffsets = poses.map(pose => wrap180(pose.pinionAngleDeg - pose.inputDeg));
  const pinionPhase = Math.atan2(pinionOffsets.reduce((s, d) => s + Math.sin(d * Math.PI / 180), 0),
    pinionOffsets.reduce((s, d) => s + Math.cos(d * Math.PI / 180), 0)) * 180 / Math.PI;
  const pinionResiduals = pinionOffsets.map(offset => Math.abs(wrap180(offset - pinionPhase)));
  const pinned = pinionResiduals.every(value => value <= angleToleranceDeg);
  const wheelResiduals = poses.map(pose => Math.abs(wrap180(pose.wheelAngleDeg - first.wheelAngleDeg
    - targetRatio * (pose.inputDeg - first.inputDeg))));
  const expectedResidual = Math.max(...wheelResiduals);
  // Unwrap the wheel angle and fit the measured ratio independently.
  let unwrapped = poses[0].wheelAngleDeg;
  const samples = poses.map((pose, index) => {
    if (index > 0) unwrapped += wrap180(pose.wheelAngleDeg - poses[index - 1].wheelAngleDeg);
    return { input: pose.inputDeg - first.inputDeg, wheel: unwrapped - first.wheelAngleDeg };
  });
  const denominator = samples.reduce((sum, sample) => sum + sample.input ** 2, 0);
  const measuredRatio = denominator > 1e-9
    ? samples.reduce((sum, sample) => sum + sample.input * sample.wheel, 0) / denominator : null;
  const ratioOk = measuredRatio !== null && Math.abs(measuredRatio - targetRatio) <= ratioTolerance;
  const direction = measuredRatio === null ? null : measuredRatio > 0 ? "same" : "opposite";
  const expectedDirection = targetRatio > 0 ? "same" : "opposite";

  const centerDistanceMm = measuredProfiles
    ? Math.hypot(input.wheel!.centerMm![0] - input.pinion!.centerMm![0],
      input.wheel!.centerMm![1] - input.pinion!.centerMm![1])
    : null;
  const expectedCenterDistanceMm = measuredProfiles
    ? input.pinion!.pitchRadiusMm! + input.wheel!.pitchRadiusMm!
    : null;
  const centerDistanceToleranceMm = input.centerDistanceToleranceMm ?? 0.2;
  const centerDistanceOk = centerDistanceMm === null || Math.abs(centerDistanceMm - expectedCenterDistanceMm!) <= centerDistanceToleranceMm;
  const toothRatioOk = toothRatio === null || Math.abs(toothRatio - expectedRatio) <= ratioTolerance;
  const ok = pinned && expectedResidual <= angleToleranceDeg && ratioOk && direction === expectedDirection
    && centerDistanceOk && toothRatioOk;
  return {
    status: ok ? "PASS" as const : "FAIL" as const,
    measuredRatio, expectedRatio, toothRatio, direction, expectedDirection,
    pinionResidualMaxDeg: Math.max(...pinionResiduals), wheelResidualMaxDeg: expectedResidual,
    centerDistanceMm, expectedCenterDistanceMm, centerDistanceToleranceMm,
    coverage: measuredProfiles
      ? "Marker orientation of both gears at listed input angles plus measured tooth counts, pitch radii and centre distance; no tooth contact, backlash, load, efficiency or manufacturing evidence."
      : "Marker tab orientation from unique STL vertices outside the addendum circle at listed input angles; marker-only rigid coupling, no tooth contact, backlash, load or manufacturing evidence.",
    reason: ok ? "The measured ratio matches the measured tooth counts and the declared ratio." : [
      pinned ? null : "pinion marker does not track the input",
      ratioOk ? null : `measured wheel ratio ${measuredRatio?.toFixed(6) ?? "null"} does not match ${targetRatio.toFixed(6)}`,
      direction === expectedDirection ? null : "the measured direction is the reverse of the declared direction",
      toothRatioOk ? null : `measured tooth ratio ${toothRatio?.toFixed(6) ?? "null"} does not match the declared ${expectedRatio.toFixed(6)}`,
      centerDistanceOk ? null : `measured centre distance ${centerDistanceMm?.toFixed(4) ?? "null"} mm does not match pitch radii sum ${expectedCenterDistanceMm?.toFixed(4) ?? "null"} mm`,
    ].filter(Boolean).join("; ") || "coupling check failed",
  };
}

export interface PlanetaryPose {
  inputDeg: number;
  sunAngleDeg: number;
  carrierAngleDeg: number;
  planetAngleDeg: number;
  planetCenterMm: [number, number];
}

/**
 * Checks an epicyclic stage with a fixed ring, sun input and carrier output.
 * The expected ratios are derived from tooth counts measured on the rendered
 * meshes, not read from the source. Both positive and negative input samples
 * are required for a verdict, so a source that only models one direction cannot
 * claim the reversal check.
 */
export function checkPlanetaryCoupling(input: {
  poses: PlanetaryPose[];
  sun: GearProfileMeasurement;
  planet: GearProfileMeasurement;
  ring: GearProfileMeasurement;
  angleToleranceDeg: number;
  ratioTolerance: number;
  centerDistanceToleranceMm?: number;
}) {
  const { poses, sun, planet, ring, angleToleranceDeg, ratioTolerance } = input;
  const centerDistanceToleranceMm = input.centerDistanceToleranceMm ?? 0.25;
  if (poses.length < 4 || poses.some(pose =>
    !Number.isFinite(pose.inputDeg) || !Number.isFinite(pose.sunAngleDeg)
    || !Number.isFinite(pose.carrierAngleDeg) || !Number.isFinite(pose.planetAngleDeg)
    || !pose.planetCenterMm.every(Number.isFinite))) {
    throw new Error("Planetary coupling needs at least four finite poses.");
  }
  if (!(angleToleranceDeg > 0) || !(ratioTolerance > 0)) throw new Error("Invalid planetary coupling tolerances.");
  if ([sun, planet, ring].some(profile => profile.status !== "MEASURED"
    || !profile.toothCount || !profile.pitchRadiusMm)
    || sun.axisSource !== "bore" || planet.axisSource !== "bore"
    || sun.marker === null || planet.marker === null) {
    return { status: "NOT_RUN" as const, reason: "Sun, planet and ring profiles with markers are required.",
      carrierRatio: null, planetAbsoluteRatio: null, ringRatioResidualMm: null,
      sunResidualMaxDeg: null, carrierResidualMaxDeg: null, planetResidualMaxDeg: null,
      centerDistanceResidualMaxMm: null, reversalSamples: 0,
      coverage: "Epicyclic ratio requires measured tooth counts and marker orientations for all three gears; no load, tooth contact, backlash or efficiency evidence." };
  }
  // Inputs may be recorded in the order they were run. Sorting is required
  // before unwrapping angles by 180-degree differences, or a negative input
  // that follows a positive one would look like a 360-degree discontinuity.
  const ordered = [...poses].sort((a, b) => a.inputDeg - b.inputDeg);
  const reversalSamples = ordered.filter(pose => pose.inputDeg < 0).length;
  const positiveSamples = ordered.filter(pose => pose.inputDeg > 0).length;
  if (reversalSamples === 0 || positiveSamples === 0) {
    return { status: "NOT_RUN" as const, reason: "Both positive and negative input poses are required to test reversal.",
      carrierRatio: null, planetAbsoluteRatio: null, ringRatioResidualMm: null,
      sunRatio: null, carrierRatioMeasured: null, planetRatioMeasured: null,
      sunResidualMaxDeg: null, carrierResidualMaxDeg: null, planetResidualMaxDeg: null,
      centerDistanceResidualMaxMm: null, reversalSamples,
      coverage: "The input signs sampled do not cover a reversal; no epicyclic ratio verdict is claimed." };
  }
  const zs = sun.toothCount!;
  const zp = planet.toothCount!;
  const zr = ring.toothCount!;
  if (zr !== zs + 2 * zp) {
    return { status: "FAIL" as const, reason: `Measured teeth ${zs}/${zp}/${zr} do not satisfy ring = sun + 2·planet.`,
      carrierRatio: null, planetAbsoluteRatio: null, ringRatioResidualMm: null,
      sunResidualMaxDeg: null, carrierResidualMaxDeg: null, planetResidualMaxDeg: null,
      centerDistanceResidualMaxMm: null, reversalSamples,
      coverage: "Measured tooth counts only." };
  }
  const ringRatioResidualMm = Math.abs(ring.pitchRadiusMm! - (sun.pitchRadiusMm! + 2 * planet.pitchRadiusMm!));
  if (ringRatioResidualMm > centerDistanceToleranceMm) {
    return { status: "FAIL" as const, reason: `Measured ring pitch radius is ${ringRatioResidualMm.toFixed(4)} mm away from sun + 2·planet.`,
      carrierRatio: null, planetAbsoluteRatio: null, ringRatioResidualMm,
      sunResidualMaxDeg: null, carrierResidualMaxDeg: null, planetResidualMaxDeg: null,
      centerDistanceResidualMaxMm: null, reversalSamples,
      coverage: "Measured pitch radii only." };
  }
  const carrierRatio = zs / (zs + zr);
  const planetAbsoluteRatio = carrierRatio * (1 + zs / zp) - zs / zp;
  const unwrap = (angles: number[]) => {
    let value = angles[0];
    return angles.map((angle, index) => {
      if (index > 0) value += wrap180(angle - angles[index - 1]);
      return value;
    });
  };
  const fitSlope = (xs: number[], ys: number[]) => {
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    return denominator > 1e-9
      ? xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0) / denominator
      : null;
  };
  const inputs = ordered.map(pose => pose.inputDeg);
  const baseInput = inputs[0];
  const relativeInputs = inputs.map(value => value - baseInput);
  const sunAngles = unwrap(ordered.map(pose => pose.sunAngleDeg));
  const carrierAngles = unwrap(ordered.map(pose => pose.carrierAngleDeg));
  const planetAngles = unwrap(ordered.map(pose => pose.planetAngleDeg));
  const sunSlope = fitSlope(relativeInputs, sunAngles.map(value => value - sunAngles[0]));
  const carrierSlope = fitSlope(relativeInputs, carrierAngles.map(value => value - carrierAngles[0]));
  const planetSlope = fitSlope(relativeInputs, planetAngles.map(value => value - planetAngles[0]));
  const residual = (angles: number[], expectedSlope: number) =>
    Math.max(...angles.map((angle, index) => Math.abs(angle - angles[0] - expectedSlope * relativeInputs[index])));
  const sunResidualMaxDeg = residual(sunAngles, 1);
  const carrierResidualMaxDeg = residual(carrierAngles, carrierRatio);
  const planetResidualMaxDeg = residual(planetAngles, planetAbsoluteRatio);
  const expectedCenter = sun.pitchRadiusMm! + planet.pitchRadiusMm!;
  const centerResiduals = ordered.map(pose => Math.abs(Math.hypot(pose.planetCenterMm[0], pose.planetCenterMm[1]) - expectedCenter));
  const slopesOk = sunSlope !== null && carrierSlope !== null && planetSlope !== null
    && Math.abs(sunSlope - 1) <= ratioTolerance
    && Math.abs(carrierSlope - carrierRatio) <= ratioTolerance
    && Math.abs(planetSlope - planetAbsoluteRatio) <= ratioTolerance;
  const ok = slopesOk && reversalSamples > 0 && positiveSamples > 0
    && sunResidualMaxDeg <= angleToleranceDeg
    && carrierResidualMaxDeg <= angleToleranceDeg
    && planetResidualMaxDeg <= angleToleranceDeg
    && Math.max(...centerResiduals) <= centerDistanceToleranceMm;
  return {
    status: ok ? "PASS" as const : "FAIL" as const,
    carrierRatio, planetAbsoluteRatio, ringRatioResidualMm,
    sunRatio: sunSlope, carrierRatioMeasured: carrierSlope, planetRatioMeasured: planetSlope,
    sunResidualMaxDeg, carrierResidualMaxDeg, planetResidualMaxDeg,
    centerDistanceResidualMaxMm: Math.max(...centerResiduals),
    reversalSamples,
    coverage: "Measured tooth counts, pitch radii and marker orientations at both input signs; fixed ring, sun input, carrier output. No tooth contact, backlash, load, efficiency or manufacturing evidence.",
    reason: ok
      ? `Measured ${zs}/${zp}/${zr} teeth; carrier ${carrierRatio.toFixed(6)}, planet ${planetAbsoluteRatio.toFixed(6)}; measured slopes ${sunSlope!.toFixed(6)}/${carrierSlope!.toFixed(6)}/${planetSlope!.toFixed(6)}.`
      : [
        reversalSamples === 0 || positiveSamples === 0 ? "both input signs are required" : null,
        sunSlope !== null && Math.abs(sunSlope - 1) <= ratioTolerance ? null : "sun marker slope is not 1",
        carrierSlope !== null && Math.abs(carrierSlope - carrierRatio) <= ratioTolerance ? null : "carrier marker does not follow the measured tooth ratio",
        planetSlope !== null && Math.abs(planetSlope - planetAbsoluteRatio) <= ratioTolerance ? null : "planet marker does not follow the measured tooth ratio",
        sunResidualMaxDeg <= angleToleranceDeg ? null : "sun marker does not track the input",
        carrierResidualMaxDeg <= angleToleranceDeg ? null : "carrier marker is not linear in the input",
        planetResidualMaxDeg <= angleToleranceDeg ? null : "planet marker is not linear in the input",
        Math.max(...centerResiduals) <= centerDistanceToleranceMm ? null : "planet centre distance does not match the measured pitch radii",
      ].filter(Boolean).join("; ") || "planetary coupling failed",
  };
}
