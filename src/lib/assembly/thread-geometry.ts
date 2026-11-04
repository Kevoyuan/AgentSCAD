import { createHash } from "crypto";
import { readBinaryStl, type TriangleMesh } from "../geometry/stl-mesh";

/**
 * Measures a helical thread from the mesh itself.
 *
 * Two facts are read out of the geometry, not out of the source:
 *
 * 1. The two thread radii come from a radius histogram over the vertices in the
 *    threaded window. A thread is the only feature that puts a large, thin
 *    population of vertices at two distinct radii, so a plain cylinder or a
 *    plain bore cannot produce two peaks.
 * 2. The pitch and hand come from the helix the crest ribbon follows. The
 *    vertices of that ribbon are binned along the axis; the circular mean of
 *    each bin is the ribbon's phase there, and a straight line through the
 *    phases gives degrees per millimetre. `pitch = 360 / |slope|` and the sign
 *    of the slope is the hand: a right-hand helix advances counter-clockwise as
 *    it rises.
 *
 * The phase estimator is only valid where the ribbon covers a proper arc, so
 * bins with too few vertices are dropped and a ribbon that is absent or
 * discontinuous yields NOT_RUN rather than a number.
 */

export interface ThreadGeometryContract {
  /** Nominal pitch the measured helix must match. */
  pitchMm: number;
  hand: "right" | "left";
  majorDiameterMm: { min: number; max: number };
  minorDiameterMm: { min: number; max: number };
  /** Absolute tolerance for pitch and both diameters. */
  toleranceMm: number;
  /** Vertices outside this radius are not part of the thread, e.g. a hex head. */
  searchRadiusMm: number;
  /** Axial window holding the thread, in the part's own frame. */
  threadRangeMm: { min: number; max: number };
}

export interface ThreadGeometryMeasurement {
  id: string;
  value: number;
  unit: "mm" | "deg";
  uncertainty: number;
  method: string;
  coverage: string;
  artifactSha256: string;
}

export interface ThreadGeometryResult {
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
  role: "external" | "internal";
  pitchMm: number | null;
  hand: "right" | "left" | null;
  majorDiameterMm: number | null;
  minorDiameterMm: number | null;
  /** Axial bins that contributed a phase sample. */
  phaseBins: number;
  /** Largest deviation of a phase sample from the fitted helix, in degrees. */
  helixResidualDeg: number | null;
  /** Axial span the fit covers, in millimetres. */
  fittedSpanMm: number | null;
  failures: string[];
  observations: ThreadGeometryMeasurement[];
  coverage: string;
  artifactSha256: string;
}

/** Half-width of the radius band that isolates the crest ribbon. */
const RIBBON_BAND_MM = 0.01;
/** Bin width along the axis for the phase samples. */
const PHASE_BIN_MM = 0.2;
const MIN_PHASE_VERTICES = 8;
const HISTOGRAM_BIN_MM = 0.02;

const round = (value: number, digits = 6) => Number(value.toFixed(digits));

function vertexCount(mesh: TriangleMesh): number {
  return mesh.coordinates.length / 3;
}

/**
 * The two strongest radius peaks that are at least `minSeparationMm` apart.
 * Peaks are refined to the mean radius of the vertices inside the bin, so the
 * reported diameter does not inherit the histogram's bin width.
 *
 * Vertices closer to the axis than half the largest radius are ignored: they
 * are cap triangulation fans, not a thread feature, and a thread root is never
 * that deep relative to its crest.
 */
function radiusPeaks(
  mesh: TriangleMesh,
  limitMm: number,
  minSeparationMm: number,
): Array<{ radiusMm: number; count: number }> {
  const coordinates = mesh.coordinates;
  let outermost = 0;
  for (let i = 0; i < coordinates.length; i += 3) {
    const r = Math.hypot(coordinates[i], coordinates[i + 1]);
    if (Number.isFinite(r) && r <= limitMm && r > outermost) outermost = r;
  }
  if (!(outermost > 0)) return [];
  const floorMm = outermost / 2;
  const counts = new Map<number, number>();
  for (let i = 0; i < coordinates.length; i += 3) {
    const r = Math.hypot(coordinates[i], coordinates[i + 1]);
    if (!Number.isFinite(r) || r > limitMm || r < floorMm) continue;
    const key = Math.round(r / HISTOGRAM_BIN_MM);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const peaks: Array<{ radiusMm: number; count: number }> = [];
  for (const [key, count] of ordered) {
    const centre = key * HISTOGRAM_BIN_MM;
    if (peaks.some((peak) => Math.abs(peak.radiusMm - centre) < minSeparationMm)) continue;
    let sum = 0, n = 0;
    for (let i = 0; i < coordinates.length; i += 3) {
      const r = Math.hypot(coordinates[i], coordinates[i + 1]);
      if (r < floorMm || Math.abs(r - centre) > 2 * HISTOGRAM_BIN_MM) continue;
      sum += r;
      n++;
    }
    if (n > 0) peaks.push({ radiusMm: sum / n, count });
    if (peaks.length === 2) break;
  }
  return peaks;
}

/**
 * Fits `phase = a + b * z` to the crest ribbon and returns the pitch it implies.
 * Vertices are binned along the axis; each bin's phase is the circular mean of
 * its vertex directions, unwrapped against the previous bin.
 */
function fitHelix(
  mesh: TriangleMesh,
  radiusMm: number,
  range: { min: number; max: number },
): { pitchMm: number; hand: "right" | "left"; bins: number; residualDeg: number; spanMm: number } | null {
  const coordinates = mesh.coordinates;
  const bins = new Map<number, { sx: number; sy: number; sz: number; n: number }>();
  for (let i = 0; i < coordinates.length; i += 3) {
    const x = coordinates[i], y = coordinates[i + 1], z = coordinates[i + 2];
    const r = Math.hypot(x, y);
    if (!Number.isFinite(r) || r <= 0) continue;
    if (Math.abs(r - radiusMm) > RIBBON_BAND_MM) continue;
    if (z < range.min || z > range.max) continue;
    const key = Math.floor(z / PHASE_BIN_MM);
    const entry = bins.get(key) ?? { sx: 0, sy: 0, sz: 0, n: 0 };
    entry.sx += x / r;
    entry.sy += y / r;
    entry.sz += z;
    entry.n++;
    bins.set(key, entry);
  }
  const keys = [...bins.keys()].sort((a, b) => a - b).filter((key) => bins.get(key)!.n >= MIN_PHASE_VERTICES);
  if (keys.length < 3) return null;
  const rows: Array<{ z: number; phase: number }> = [];
  let previous: number | null = null;
  for (const key of keys) {
    const entry = bins.get(key)!;
    let phase = (Math.atan2(entry.sy, entry.sx) * 180) / Math.PI;
    if (previous !== null) {
      while (phase - previous > 180) phase -= 360;
      while (phase - previous < -180) phase += 360;
    }
    rows.push({ z: entry.sz / entry.n, phase });
    previous = phase;
  }
  const n = rows.length;
  const meanZ = rows.reduce((sum, row) => sum + row.z, 0) / n;
  const meanPhase = rows.reduce((sum, row) => sum + row.phase, 0) / n;
  let numerator = 0, denominator = 0;
  for (const row of rows) {
    numerator += (row.z - meanZ) * (row.phase - meanPhase);
    denominator += (row.z - meanZ) ** 2;
  }
  if (!(denominator > 1e-12)) return null;
  const slope = numerator / denominator;
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) return null;
  const residualDeg = Math.max(...rows.map((row) => Math.abs(row.phase - (meanPhase + slope * (row.z - meanZ)))));
  return {
    pitchMm: 360 / Math.abs(slope),
    hand: slope > 0 ? "right" : "left",
    bins: n,
    residualDeg,
    spanMm: rows[n - 1].z - rows[0].z,
  };
}

export function measureThreadGeometry(input: {
  stl: Buffer;
  role: "external" | "internal";
  contract: ThreadGeometryContract;
}): ThreadGeometryResult {
  const { contract, role } = input;
  const sha256 = createHash("sha256").update(input.stl).digest("hex");
  const base = {
    role,
    artifactSha256: sha256,
    pitchMm: null as number | null,
    hand: null as "right" | "left" | null,
    majorDiameterMm: null as number | null,
    minorDiameterMm: null as number | null,
    phaseBins: 0,
    helixResidualDeg: null as number | null,
    fittedSpanMm: null as number | null,
    failures: [] as string[],
    observations: [] as ThreadGeometryMeasurement[],
  };
  const coverage =
    `Radius histogram over every vertex inside r <= ${contract.searchRadiusMm} mm and ` +
    `z in [${contract.threadRangeMm.min}, ${contract.threadRangeMm.max}] mm; helix phase fitted on ` +
    `the ${role === "external" ? "major" : "minor"} radius ribbon only. No flank angle, thread ` +
    `length, runout, strength, torque or manufactured fit is measured.`;
  if (!(contract.pitchMm > 0) || !(contract.toleranceMm > 0) || !(contract.searchRadiusMm > 0) ||
      !Number.isFinite(contract.threadRangeMm.min) || !Number.isFinite(contract.threadRangeMm.max) ||
      contract.threadRangeMm.max <= contract.threadRangeMm.min) {
    throw new Error("Invalid thread geometry contract");
  }
  if (!Buffer.isBuffer(input.stl) || input.stl.length < 84) {
    return { ...base, status: "ERROR", reason: "The part has no usable binary STL.", coverage };
  }
  let mesh: TriangleMesh;
  try {
    mesh = readBinaryStl(input.stl);
  } catch (error) {
    return { ...base, status: "ERROR", reason: error instanceof Error ? error.message : "Unreadable mesh", coverage };
  }
  if (mesh.triangleCount === 0) {
    return { ...base, status: "ERROR", reason: "The part mesh is empty.", coverage };
  }
  if (vertexCount(mesh) < 100) {
    return { ...base, status: "NOT_RUN", reason: "Too few vertices to resolve a thread profile.", coverage };
  }

  const peaks = radiusPeaks(mesh, contract.searchRadiusMm, 0.3);
  if (peaks.length < 2) {
    return {
      ...base,
      status: "NOT_RUN",
      reason: `Only ${peaks.length} distinct radius population(s) were found inside r <= ${contract.searchRadiusMm} mm; ` +
        `a thread needs two, one at the crest and one at the root.`,
      coverage,
    };
  }
  const majorRadius = Math.max(peaks[0].radiusMm, peaks[1].radiusMm);
  const minorRadius = Math.min(peaks[0].radiusMm, peaks[1].radiusMm);
  const majorDiameterMm = round(2 * majorRadius);
  const minorDiameterMm = round(2 * minorRadius);
  // The crest ribbon sits at the major radius for an external thread and at the
  // minor radius for an internal one: the material that engages is the rib.
  const helix = fitHelix(mesh, role === "external" ? majorRadius : minorRadius, contract.threadRangeMm);
  if (!helix) {
    return {
      ...base,
      status: "NOT_RUN",
      reason: "The crest ribbon did not yield at least three usable axial phase samples, so no pitch or hand was measured.",
      majorDiameterMm,
      minorDiameterMm,
      coverage,
    };
  }

  const failures: string[] = [];
  if (Math.abs(helix.pitchMm - contract.pitchMm) > contract.toleranceMm) {
    failures.push(`The measured pitch is ${helix.pitchMm.toFixed(4)} mm, not ${contract.pitchMm} +/- ${contract.toleranceMm} mm.`);
  }
  if (helix.hand !== contract.hand) {
    failures.push(`The measured helix is ${helix.hand}-hand, not ${contract.hand}-hand.`);
  }
  if (majorDiameterMm < contract.majorDiameterMm.min || majorDiameterMm > contract.majorDiameterMm.max) {
    failures.push(`The measured major diameter is ${majorDiameterMm.toFixed(4)} mm, outside ${contract.majorDiameterMm.min}-${contract.majorDiameterMm.max} mm.`);
  }
  if (minorDiameterMm < contract.minorDiameterMm.min || minorDiameterMm > contract.minorDiameterMm.max) {
    failures.push(`The measured minor diameter is ${minorDiameterMm.toFixed(4)} mm, outside ${contract.minorDiameterMm.min}-${contract.minorDiameterMm.max} mm.`);
  }

  const pitchUncertaintyMm = Math.max(1e-6, (helix.residualDeg / 360) * helix.pitchMm / Math.sqrt(helix.bins));
  const coverageText = `${helix.bins} axial bins of ${PHASE_BIN_MM} mm over ${helix.spanMm.toFixed(2)} mm, ${vertexCount(mesh)} vertices`;
  const observations: ThreadGeometryMeasurement[] = [
    {
      id: `thread-pitch-${role}-mm`, value: round(helix.pitchMm), unit: "mm", uncertainty: round(pitchUncertaintyMm),
      method: "Straight-line fit of the crest-ribbon phase against axial position; pitch = 360 / |slope|.",
      coverage: coverageText, artifactSha256: sha256,
    },
    {
      id: `thread-major-diameter-${role}-mm`, value: majorDiameterMm, unit: "mm", uncertainty: 0.01,
      method: "Largest radius population in the threaded window, refined to the mean radius of its vertices.",
      coverage: coverageText, artifactSha256: sha256,
    },
    {
      id: `thread-minor-diameter-${role}-mm`, value: minorDiameterMm, unit: "mm", uncertainty: 0.01,
      method: "Second radius population in the threaded window, refined to the mean radius of its vertices.",
      coverage: coverageText, artifactSha256: sha256,
    },
  ];

  const status = failures.length === 0 ? "PASS" as const : "FAIL" as const;
  return {
    ...base,
    status,
    reason: status === "PASS"
      ? `The ${role} thread measures a ${helix.pitchMm.toFixed(4)} mm ${helix.hand}-hand helix with ` +
        `${majorDiameterMm.toFixed(3)}/${minorDiameterMm.toFixed(3)} mm major/minor diameter. ` +
        `This covers the measured radii and phase only.`
      : `${failures.length} thread check(s) failed: ${failures.join(" ")}`,
    pitchMm: round(helix.pitchMm),
    hand: helix.hand,
    majorDiameterMm,
    minorDiameterMm,
    phaseBins: helix.bins,
    helixResidualDeg: round(helix.residualDeg, 3),
    fittedSpanMm: round(helix.spanMm, 4),
    failures,
    observations,
    coverage,
  };
}
