import { multiplyMatrices, rotationAboutAxis, translationMatrix } from "./path-and-motion";
import type { Vec3 } from "../geometry/stl-mesh";

const MAX_POSES = 4096;

export interface ScrewPathInput {
  /** Lengths are millimetres; angles below are explicitly degrees. */
  units: "mm";
  /** Oriented axis expressed in the fixed world frame. */
  axis: { origin: Vec3; direction: Vec3 };
  hand: "right" | "left";
  /** Positive axial advance magnitude per full turn, which need not equal pitch for a multi-start thread. */
  leadMm: number;
  startAngleDeg: number;
  endAngleDeg: number;
  /** Maximum commanded angle increment between adjacent poses. */
  maxStepDeg: number;
  /** Bounded allocation; cannot exceed the implementation-wide limit. */
  maxPoses?: number;
}

/**
 * Expand a prescribed ideal helical motion into cumulative world-space rigid
 * transforms. The first transform is identity: it acts on geometry at the
 * supplied start angle, not on an unplaced part's local frame.
 *
 * By the right-hand rule about the oriented axis, a positive rotation moves +axis
 * by `leadMm` per revolution. A left-hand rotation moves -axis; reversing the
 * input turn reverses both displacement and rotation. This is a kinematic
 * path construction only: it does not infer a thread from geometry, check
 * collision, verify engagement, or establish continuous/physical feasibility.
 */
export function sampleScrewPath(input: ScrewPathInput) {
  if (!input || input.units !== "mm" || !["right", "left"].includes(input.hand)) {
    throw new Error("Expected millimetres and a right- or left-hand screw");
  }
  const axis = input.axis;
  const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n));
  if (!axis || !vector(axis.origin) || !vector(axis.direction)) throw new Error("Axis origin and direction must be finite 3D vectors");
  const magnitude = Math.hypot(...axis.direction);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) throw new Error("Axis direction must be nonzero and finite");
  if (![input.leadMm, input.startAngleDeg, input.endAngleDeg, input.maxStepDeg].every(Number.isFinite) ||
      input.leadMm <= 0 || input.maxStepDeg <= 0 || input.maxStepDeg > 180) {
    throw new Error("Lead and angle bounds must be finite; lead and step must be positive, with step at most 180 degrees");
  }
  const maxPoses = input.maxPoses ?? MAX_POSES;
  if (!Number.isInteger(maxPoses) || maxPoses < 2 || maxPoses > MAX_POSES) throw new Error(`maxPoses must be between 2 and ${MAX_POSES}`);
  const deltaDeg = input.endAngleDeg - input.startAngleDeg;
  if (!Number.isFinite(deltaDeg) || deltaDeg === 0) throw new Error("Start and end angles must define finite nonzero travel");
  const intervals = Math.ceil(Math.abs(deltaDeg) / input.maxStepDeg);
  if (!Number.isSafeInteger(intervals) || intervals + 1 > maxPoses) throw new Error("Screw path exceeds the pose budget");
  const unit: Vec3 = axis.direction.map(n => n / magnitude) as Vec3;
  const origin: Vec3 = [...axis.origin];
  const sign = input.hand === "right" ? 1 : -1;
  const poses: number[][] = [];
  const anglesDegrees: number[] = [];
  let actualStepDeg = 0;
  for (let i = 0; i <= intervals; i++) {
    const fraction = i / intervals;
    const angleDeg = i === intervals ? input.endAngleDeg : input.startAngleDeg + fraction * deltaDeg;
    const relativeDeg = angleDeg - input.startAngleDeg;
    const axialMm = sign * input.leadMm * (relativeDeg / 360);
    if (!Number.isFinite(angleDeg) || !Number.isFinite(axialMm) || (i > 0 && Math.sign(deltaDeg) * (angleDeg - anglesDegrees[i-1]) <= 0)) {
      throw new Error("Screw path loses finite numeric angle or translation precision");
    }
    if (i > 0) {
      const step = Math.abs(angleDeg - anglesDegrees[i - 1]);
      if (step > input.maxStepDeg + 1e-9) throw new Error("Screw path exceeds the step bound at available numeric precision");
      actualStepDeg = Math.max(actualStepDeg, step);
    }
    const rotation = rotationAboutAxis(origin, unit, relativeDeg * Math.PI / 180);
    const translation = translationMatrix(unit.map(n => n * axialMm) as Vec3);
    const pose = multiplyMatrices(translation, rotation);
    if (pose.some(n => !Number.isFinite(n))) throw new Error("Screw path transform exceeds finite numeric range");
    anglesDegrees.push(angleDeg);
    poses.push(pose);
  }
  return {
    method: "ideal-helical-pose-expansion/v1" as const,
    units: "mm" as const,
    angleUnits: "deg" as const,
    axis: { origin, direction: unit },
    hand: input.hand,
    leadMm: input.leadMm,
    startAngleDeg: input.startAngleDeg,
    endAngleDeg: input.endAngleDeg,
    maxStepDeg: input.maxStepDeg,
    actualStepDeg,
    axialTravelMm: sign * input.leadMm * (deltaDeg / 360),
    anglesDegrees,
    poses,
    collision: { status: "NOT_RUN" as const, reason: "No collision check was performed." },
    physical: { status: "NOT_RUN" as const, reason: "No manufactured specimen was tested." },
    coverage: "Ideal poses at listed angles only; no continuous swept-volume, engagement, torque, fit or physical function is established.",
  };
}
