import { validateAssemblySpec } from "./assembly-spec";

type Vec = [number, number, number];
type Frame = { origin: Vec; direction: Vec };
type Result = {
  connectionId: string;
  status: "PASS" | "FAIL" | "NOT_RUN";
  reason: string;
  angleDegrees?: number;
  axisOffsetMm?: number;
};

function transformFrame(m: number[], frame: Frame): Frame {
  const transformVector = ([x, y, z]: Vec): Vec => [
    m[0] * x + m[1] * y + m[2] * z,
    m[4] * x + m[5] * y + m[6] * z,
    m[8] * x + m[9] * y + m[10] * z,
  ];
  const rotated = transformVector(frame.origin);
  const direction = transformVector(frame.direction);
  const norm = Math.hypot(...direction);
  return {
    origin: [rotated[0] + m[3], rotated[1] + m[7], rotated[2] + m[11]],
    direction: [direction[0] / norm, direction[1] / norm, direction[2] / norm],
  };
}

/**
 * Checks only declared joint axes in one declared assembly pose. This does not
 * inspect the SCAD or mesh, verify a mating surface, limits, fit, collision,
 * motion, or prove that the declared frames correspond to real geometry.
 * Opposite direction vectors represent the same undirected geometric axis.
 */
export function checkDeclaredJointFrames(input: {
  spec: unknown;
  maxAxisOffsetMm: number;
  maxAngleDegrees: number;
}): Result[] {
  if (!Number.isFinite(input.maxAxisOffsetMm) || input.maxAxisOffsetMm < 0 ||
      !Number.isFinite(input.maxAngleDegrees) || input.maxAngleDegrees < 0 || input.maxAngleDegrees > 90) {
    throw new Error("Joint frame tolerances must be finite and within valid bounds");
  }
  const parsed = validateAssemblySpec(input.spec);
  if (!parsed.success) throw new Error(`Invalid assembly specification: ${parsed.error.message}`);
  const spec = parsed.data;
  const instances = new Map(spec.instances.map((instance) => [instance.id, instance]));
  return spec.connections.map((connection): Result => {
    if (!["revolute", "prismatic", "screw"].includes(connection.type)) {
      return { connectionId: connection.id, status: "NOT_RUN", reason: "This connection type has no supported declared-axis check." };
    }
    if (!connection.frameA || !connection.frameB) {
      return { connectionId: connection.id, status: "NOT_RUN", reason: "A local joint axis was not specified." };
    }
    const a = transformFrame(instances.get(connection.a)!.transform, connection.frameA);
    const b = transformFrame(instances.get(connection.b)!.transform, connection.frameB);
    const dot = Math.abs(a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2]);
    const angleDegrees = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    const d: Vec = [b.origin[0] - a.origin[0], b.origin[1] - a.origin[1], b.origin[2] - a.origin[2]];
    const parallel = d[0] * a.direction[0] + d[1] * a.direction[1] + d[2] * a.direction[2];
    const axisOffsetMm = Math.hypot(d[0] - parallel * a.direction[0], d[1] - parallel * a.direction[1], d[2] - parallel * a.direction[2]);
    const passed = angleDegrees <= input.maxAngleDegrees && axisOffsetMm <= input.maxAxisOffsetMm;
    return {
      connectionId: connection.id,
      status: passed ? "PASS" : "FAIL",
      reason: "Declared axes compared at the declared pose only; geometry and function were not measured.",
      angleDegrees,
      axisOffsetMm,
    };
  });
}
