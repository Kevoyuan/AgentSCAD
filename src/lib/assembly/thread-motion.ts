import { createHash } from "crypto";
import { checkReconstructedMesh } from "./reconstructed-mesh-check";
import { readBinaryStl, meshBounds, sectionMesh, castRadialProfile, type TriangleMesh } from "../geometry/stl-mesh";

/**
 * Measures what a threaded pair actually does when the nut is turned.
 *
 * The poses are rendered by the source at commanded turn angles, so the input
 * angle is not evidence on its own: a source can rotate a nut, translate a nut,
 * or do both with the wrong ratio. Three independent observations decide it:
 *
 * - the nut's axial position, taken as the lowest mesh vertex, which the hex
 *   profile cannot fake because a rotation about the thread axis does not move
 *   it;
 * - a first-harmonic phase of a measured radial section, which distinguishes
 *   rotations that the hexagon alone aliases modulo 60 degrees;
 * - the bolt mesh bounds, surface correspondence and section phase, which
 *   check its sampled geometry remains fixed in all axes.
 *
 * The lead per turn comes from a straight-line fit of position against angle.
 * Its sign is the functional hand: a right-hand thread advances along +Z when
 * the nut is turned counter-clockwise.
 */

export interface ThreadMotionContract {
  pitchMm: number;
  hand: "right" | "left";
  /** Absolute tolerance for the lead per turn and for the bolt's stillness. */
  toleranceMm: number;
  /** Allowed spread of the orientation offset, in degrees. */
  orientationToleranceDeg: number;
  /** The sampled poses must cover at least this many turns. */
  minTurns: number;
  /** Radius above which a vertex belongs to the hexagonal outline. */
  cornerRadiusMm: number;
}

export interface ThreadPoseMeasurement {
  turnDeg: number;
  nutBottomZmm: number;
  nutOrientationDeg: number;
  boltBottomZmm: number;
  boltOrientationDeg: number;
  /** First-harmonic phase of the measured radial section; null when unobservable. */
  nutFeaturePhaseDeg: number | null;
  boltFeaturePhaseDeg: number | null;
  /** Residual of the nut position against the fitted lead, in millimetres. */
  advanceResidualMm: number | null;
}

export interface ThreadMotionMeasurement {
  id: string;
  value: number;
  unit: "mm" | "deg";
  /** Null means total measurement uncertainty has not been calibrated. */
  uncertainty: number | null;
  method: string;
  coverage: string;
  artifactSha256: string;
}

export interface ThreadMotionResult {
  status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN";
  reason: string;
  leadPerTurnMm: number | null;
  hand: "right" | "left" | null;
  advanceResidualMm: number | null;
  orientationSpreadDeg: number | null;
  featureOrientationErrorDeg: number | null;
  boltDriftMm: number | null;
  turnsCovered: number | null;
  poses: ThreadPoseMeasurement[];
  failures: string[];
  observations: ThreadMotionMeasurement[];
  coverage: string;
  artifactSha256: string;
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const wrap60 = (degrees: number) => {
  const wrapped = ((degrees % 60) + 60) % 60;
  return wrapped > 30 ? wrapped - 60 : wrapped;
};

/** Orientation of a hexagonal outline, modulo 60 degrees. */
function hexOrientationDeg(mesh: TriangleMesh, cornerRadiusMm: number): number | null {
  const coordinates = mesh.coordinates;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < coordinates.length; i += 3) {
    const x = coordinates[i], y = coordinates[i + 1];
    const r = Math.hypot(x, y);
    if (!(r >= cornerRadiusMm)) continue;
    const angle = Math.atan2(y, x);
    sx += Math.cos(6 * angle);
    sy += Math.sin(6 * angle);
    n++;
  }
  if (n < 6 || (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12)) return null;
  return (Math.atan2(sy, sx) * 180) / (6 * Math.PI);
}

/** First harmonic of a horizontal radial surface section. An approximately
 * symmetric section is deliberately unobservable rather than a 60°-aliased pass.
 * The section detects a distinctive geometric feature, not its semantic identity.
 */
function featurePhase(mesh: TriangleMesh): number | null {
  const bounds = meshBounds(mesh);
  const height = bounds.max[2] - bounds.min[2];
  if (!Number.isFinite(height) || height <= 1e-4) return null;
  const section = sectionMesh(mesh, [0, 0, bounds.min[2] + height * 0.37], [0, 0, 1]);
  if (!section.segments.length || section.segments.length > 20_000) return null;
  const radius = Math.max(...bounds.min.slice(0, 2).map(Math.abs), ...bounds.max.slice(0, 2).map(Math.abs)) * 2 + 1;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const profile = castRadialProfile(section, [0, 0], 360, radius);
  if (profile.misses) return null;
  let x = 0, y = 0;
  profile.radii.forEach((r, i) => { const angle = i * Math.PI / 180; x += r * Math.cos(angle); y += r * Math.sin(angle); });
  // Units of amplitude are mm. Low signal makes the phase unstable or ambiguous.
  if (Math.hypot(x, y) / profile.radii.length < 0.01) return null;
  return Math.atan2(y, x) * 180 / Math.PI;
}
const wrap180 = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

function lowestZ(mesh: TriangleMesh): number {
  let lowest = Infinity;
  const coordinates = mesh.coordinates;
  for (let i = 2; i < coordinates.length; i += 3) if (coordinates[i] < lowest) lowest = coordinates[i];
  return lowest;
}

export function measureThreadAdvance(input: {
  contract: ThreadMotionContract;
  poses: Array<{ turnDeg: number; bolt: Buffer; nut: Buffer }>;
}): ThreadMotionResult {
  const { contract, poses } = input;
  const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  const artifactSha256 = createHash("sha256")
    .update(poses.map((pose) => `${pose.turnDeg}:${sha256(pose.bolt)}:${sha256(pose.nut)}`).join("|"))
    .digest("hex");
  const base = {
    artifactSha256,
    leadPerTurnMm: null as number | null,
    hand: null as "right" | "left" | null,
    advanceResidualMm: null as number | null,
    orientationSpreadDeg: null as number | null,
    featureOrientationErrorDeg: null as number | null,
    boltDriftMm: null as number | null,
    turnsCovered: null as number | null,
    failures: [] as string[],
    observations: [] as ThreadMotionMeasurement[],
  };
  const coverage =
    `Measured at the listed commanded turn angles only: nut bottom height from the lowest mesh vertex, ` +
    `nut and bolt section first-harmonic phases resolve sixfold ambiguity; full bolt mesh is compared with its initial pose. ` +
    `One section about the declared origin; feature identity, whole-part rigidity, absolute datum and turns between poses are not established. ` +
    `No flank contact, torque, friction, preload, wear, cross-threading or manufactured fit is measured.`;
  if (![contract.pitchMm, contract.toleranceMm, contract.minTurns, contract.cornerRadiusMm, contract.orientationToleranceDeg].every(Number.isFinite) ||
      !(contract.pitchMm > 0) || !(contract.toleranceMm > 0) || !(contract.minTurns > 0) ||
      !(contract.cornerRadiusMm > 0) || !(contract.orientationToleranceDeg > 0)) {
    throw new Error("Invalid thread motion contract");
  }
  if (!Array.isArray(poses) || poses.length < 3 || poses.length > 64) throw new Error("Expected 3 to 64 poses");
  const turns = poses.map((pose) => pose.turnDeg);
  if (turns.some((turn) => !Number.isFinite(turn)) || new Set(turns).size !== turns.length) {
    throw new Error("Turn angles must be finite and unique");
  }

  const measured: ThreadPoseMeasurement[] = [];
  for (const pose of poses) {
    let nut: TriangleMesh, bolt: TriangleMesh;
    try {
      nut = readBinaryStl(pose.nut);
      bolt = readBinaryStl(pose.bolt);
    } catch (error) {
      return {
        ...base,
        status: "ERROR",
        poses: measured,
        reason: `The meshes at ${pose.turnDeg} degrees could not be read: ${error instanceof Error ? error.message : String(error)}`,
        coverage,
      };
    }
    const nutOrientation = hexOrientationDeg(nut, contract.cornerRadiusMm);
    const boltOrientation = hexOrientationDeg(bolt, contract.cornerRadiusMm);
    if (nutOrientation === null || boltOrientation === null) {
      return {
        ...base,
        status: "NOT_RUN",
        poses: measured,
        reason: `At ${pose.turnDeg} degrees the hexagonal outline was not found outside r = ${contract.cornerRadiusMm} mm, ` +
          `so the parts cannot be oriented.`,
        coverage,
      };
    }
    measured.push({
      turnDeg: pose.turnDeg,
      nutBottomZmm: round(lowestZ(nut)),
      nutOrientationDeg: round(nutOrientation, 3),
      boltBottomZmm: round(lowestZ(bolt)),
      boltOrientationDeg: round(boltOrientation, 3),
      nutFeaturePhaseDeg: featurePhase(nut),
      boltFeaturePhaseDeg: featurePhase(bolt),
      advanceResidualMm: null,
    });
  }

  const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  let boltUnknown = false;
  const boltChanges: string[] = [];
  for (const pose of poses.slice(1)) {
    if (sha256(pose.bolt) === sha256(poses[0].bolt)) continue;
    const referenceBounds = meshBounds(readBinaryStl(poses[0].bolt));
    const currentBounds = meshBounds(readBinaryStl(pose.bolt));
    const boundsChange = Math.max(...referenceBounds.min.map((v, i) => Math.abs(v-currentBounds.min[i])), ...referenceBounds.max.map((v, i) => Math.abs(v-currentBounds.max[i])));
    if (boundsChange > contract.toleranceMm) {
      boltChanges.push(`The bolt mesh bounds change at ${pose.turnDeg} degrees; the bolt must stay fixed in all axes.`);
      continue;
    }
    if (contract.toleranceMm < 1e-6 || contract.toleranceMm > 0.1) { boltUnknown = true; continue; }
    const comparison = checkReconstructedMesh({ local: poses[0].bolt, posed: pose.bolt, transform: identity, toleranceMm: contract.toleranceMm });
    if (comparison.status === "FAIL") boltChanges.push(`The bolt mesh bounds change at ${pose.turnDeg} degrees; the bolt must stay fixed in all axes.`);
    else if (comparison.status !== "PASS") boltUnknown = true;
  }
  const phasesAvailable = measured.every(p => p.nutFeaturePhaseDeg !== null && p.boltFeaturePhaseDeg !== null);
  if (phasesAvailable && measured.some(p => Math.abs(wrap180(p.boltFeaturePhaseDeg! - measured[0].boltFeaturePhaseDeg!)) > contract.orientationToleranceDeg)) {
    boltChanges.push("The bolt section feature changes orientation between poses; the bolt must remain fixed.");
  }
  // A proven displacement remains FAIL, even when a separate feature is unavailable.
  if (!phasesAvailable || boltUnknown) {
    if (boltChanges.length) return { ...base, status: "FAIL", poses: measured, reason: boltChanges.join(" "), failures: boltChanges, coverage };
    return { ...base, status: "NOT_RUN", poses: measured, reason: boltUnknown
      ? "Bolt meshes lack a decisive full-surface correspondence; fixed pose cannot be verified."
      : "A distinct first-harmonic radial feature was not measurable on both parts; orientation modulo 360 degrees is unverified.", coverage };
  }

  const n = measured.length;
  const meanTurn = measured.reduce((sum, pose) => sum + pose.turnDeg, 0) / n;
  const meanZ = measured.reduce((sum, pose) => sum + pose.nutBottomZmm, 0) / n;
  let numerator = 0, denominator = 0;
  for (const pose of measured) {
    numerator += (pose.turnDeg - meanTurn) * (pose.nutBottomZmm - meanZ);
    denominator += (pose.turnDeg - meanTurn) ** 2;
  }
  if (!(denominator > 1e-9)) {
    return { ...base, status: "NOT_RUN", poses: measured, reason: "Every pose used the same turn angle, so no lead can be fitted.", coverage };
  }
  const slope = numerator / denominator;
  const leadPerTurnMm = slope * 360;
  let advanceResidualMm = 0;
  for (const pose of measured) {
    pose.advanceResidualMm = round(pose.nutBottomZmm - (meanZ + slope * (pose.turnDeg - meanTurn)));
    advanceResidualMm = Math.max(advanceResidualMm, Math.abs(pose.advanceResidualMm));
  }
  const turnsCovered = (Math.max(...turns) - Math.min(...turns)) / 360;

  const offsets = measured.map((pose) => wrap60(pose.nutOrientationDeg - pose.turnDeg));
  const orientationSpreadDeg = Math.max(...offsets) - Math.min(...offsets);
  const boltZ = measured.map((pose) => pose.boltBottomZmm);
  const boltDriftMm = Math.max(...boltZ) - Math.min(...boltZ);
  const boltOrientationSpread = Math.max(...measured.map((p) => p.boltOrientationDeg)) -
    Math.min(...measured.map((p) => p.boltOrientationDeg));
  // A zero advance has no hand: reporting one would invent a direction.
  const hand: "right" | "left" | null = Math.abs(leadPerTurnMm) <= contract.toleranceMm
    ? null
    : leadPerTurnMm > 0 ? "right" : "left";

  const failures: string[] = [...boltChanges];
  const first = measured[0];
  const phaseError = Math.max(...measured.map(p => Math.abs(wrap180(p.nutFeaturePhaseDeg! - first.nutFeaturePhaseDeg! - (p.turnDeg - first.turnDeg)))));
  const boltPhaseError = Math.max(...measured.map(p => Math.abs(wrap180(p.boltFeaturePhaseDeg! - first.boltFeaturePhaseDeg!))));
  if (phaseError > contract.orientationToleranceDeg) failures.push(`The nut feature orientation deviates from the commanded rotation by up to ${phaseError.toFixed(3)} degrees.`);
  if (boltPhaseError > contract.orientationToleranceDeg) failures.push(`The bolt feature orientation changed by up to ${boltPhaseError.toFixed(3)} degrees.`);
  // The pitch is a magnitude; the sign of the advance is the hand, checked next.
  const leadMagnitudeMm = Math.abs(leadPerTurnMm);
  if (Math.abs(leadMagnitudeMm - contract.pitchMm) > contract.toleranceMm) {
    failures.push(`The nut advances ${leadMagnitudeMm.toFixed(4)} mm per turn, not the required ${contract.pitchMm} +/- ${contract.toleranceMm} mm.`);
  }
  if (hand !== null && hand !== contract.hand) {
    failures.push(`Turning the nut counter-clockwise moves it along ${hand === "right" ? "+Z" : "-Z"}; the measured advance direction is ${hand}-hand, not ${contract.hand}-hand.`);
  }
  if (advanceResidualMm > contract.toleranceMm) {
    failures.push(`The nut position deviates from a constant lead by up to ${advanceResidualMm.toFixed(4)} mm.`);
  }
  if (orientationSpreadDeg > contract.orientationToleranceDeg) {
    failures.push(`The nut orientation does not follow the commanded angle: the offset varies by ${orientationSpreadDeg.toFixed(3)} degrees.`);
  }
  if (boltDriftMm > contract.toleranceMm) {
    failures.push(`The bolt moves ${boltDriftMm.toFixed(4)} mm between poses; it must stay fixed.`);
  }
  if (boltOrientationSpread > contract.orientationToleranceDeg) {
    failures.push(`The bolt orientation changes by ${boltOrientationSpread.toFixed(3)} degrees between poses.`);
  }
  if (turnsCovered < contract.minTurns) {
    failures.push(`The poses cover ${turnsCovered.toFixed(2)} turns, fewer than the required ${contract.minTurns}.`);
  }

  const coverageText = `${n} poses over ${turnsCovered.toFixed(2)} turns`;
  const observations: ThreadMotionMeasurement[] = [
    {
      id: "thread-lead-per-turn-mm", value: round(leadMagnitudeMm), unit: "mm", uncertainty: 1e-4,
      method: "Straight-line fit of the nut's lowest vertex against the commanded turn angle, times 360.",
      coverage: coverageText, artifactSha256,
    },
    {
      id: "thread-advance-residual-mm", value: round(advanceResidualMm), unit: "mm", uncertainty: 1e-4,
      method: "Largest deviation of a measured nut height from the fitted lead.",
      coverage: coverageText, artifactSha256,
    },
    {
      id: "thread-nut-feature-angle-error-deg", value: round(phaseError, 3), unit: "deg", uncertainty: null,
      method: "Difference modulo 360 between commanded rotation and first radial harmonic of a horizontal mesh section, relative to the first pose; 360 angular rays; total measurement uncertainty is not calibrated.",
      coverage: coverageText, artifactSha256,
    },
    {
      id: "thread-nut-orientation-spread-deg", value: round(orientationSpreadDeg, 3), unit: "deg", uncertainty: 0.05,
      method: "Spread of (measured hex orientation - commanded angle) modulo 60 degrees.",
      coverage: coverageText, artifactSha256,
    },
  ];

  const status = failures.length === 0 ? "PASS" as const : "FAIL" as const;
  return {
    ...base,
    status,
    reason: status === "PASS"
      ? `The nut advances ${leadMagnitudeMm.toFixed(4)} mm per commanded turn in the ${hand}-hand direction, stays within ` +
        `${advanceResidualMm.toFixed(4)} mm of a constant lead, and the bolt does not move. This covers the sampled angles only.`
      : `${failures.length} motion check(s) failed: ${failures.join(" ")}`,
    leadPerTurnMm: round(leadPerTurnMm),
    hand,
    advanceResidualMm: round(advanceResidualMm),
    orientationSpreadDeg: round(orientationSpreadDeg, 3),
    featureOrientationErrorDeg: round(phaseError, 3),
    boltDriftMm: round(boltDriftMm),
    turnsCovered: round(turnsCovered, 4),
    poses: measured,
    failures,
    observations,
    coverage,
  };
}
