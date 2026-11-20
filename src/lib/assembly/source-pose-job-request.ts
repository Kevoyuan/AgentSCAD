import { z } from "zod";
import type { AssemblySpec } from "./assembly-spec";
import { checkDeclaredJointFrames } from "./joint-frame-check";
import { multiplyMatrices, rotationAboutAxis } from "./path-and-motion";
import type { SourcePoseSample } from "./source-pose-observer";

const SHA = /^[a-f0-9]{64}$/;
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const scadParameter = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RequestSchema = z.object({
  sourceSha256: z.string().regex(SHA),
  specSha256: z.string().regex(SHA),
  connectionId: z.string().regex(identifier),
  sourceParameter: z.string().regex(scadParameter),
  rotationDeg: z.number().finite().min(1).max(90),
  sampleCount: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).optional(),
  /** Separate, explicit confirmation; never treated as frozen requirement acceptance. */
  confirmedBinding: z.literal(true),
}).strict();

export type SourcePoseJobRequest = z.infer<typeof RequestSchema>;
export type SourcePoseJobBinding = {
  connectionId: string;
  sourceParameter: string;
  movingInstanceId: string;
  groundedInstanceId: string;
  rotationDeg: number;
  sampleCount: 3 | 5 | 7 | 9;
  maximumSampleAngleGapDeg: number;
  axis: { origin: [number, number, number]; direction: [number, number, number] };
  samples: SourcePoseSample[];
  /** Only confirms which parameter the user chose. NOT a proof of CAD semantics. */
  sourceBindingConfirmedByUser: true;
};

export class InvalidSourcePoseJobRequest extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSourcePoseJobRequest"; }
}
function reject(message: string): never { throw new InvalidSourcePoseJobRequest(message); }

/** All rigid matrices originate on the server from a declared grounded joint. */
export function bindSourcePoseJobRequest(input: {
  raw: unknown;
  spec: AssemblySpec;
  scadSource: string;
}): { request: SourcePoseJobRequest; binding: SourcePoseJobBinding } {
  const parsed = RequestSchema.safeParse(input.raw);
  if (!parsed.success) return reject("Specify current source/spec hashes, a revolute connection, a source parameter and an explicitly confirmed angle.");
  const request = parsed.data;
  const { spec, scadSource } = input;
  if (Buffer.byteLength(scadSource, "utf8") > 256 * 1024) return reject("Source exceeds the bounded pose-inspection limit.");
  if (spec.parts.length > 8 || spec.instances.length > 12 || spec.instances.length < 2 ||
    spec.parts.some(part => part.source !== "generated")) {
    return reject("Source-pose inspection requires 2–12 complete generated instances and no more than 8 parts.");
  }
  if (request.sourceParameter === "agentscad_part" || request.sourceParameter.startsWith("$")) {
    return reject("The part selector or built-in OpenSCAD variables cannot be used as a source motion parameter.");
  }
  const declaredParameter = new RegExp("(?:^|\\n)\\s*" + request.sourceParameter + "\\s*=", "m");
  if (!declaredParameter.test(scadSource)) return reject("The explicitly named source motion parameter is not declared in this CAD source.");
  const joint = spec.connections.find(connection => connection.id === request.connectionId);
  if (!joint || joint.type !== "revolute" || !joint.frameA || !joint.frameB ||
    !joint.range || joint.range.unit !== "deg" ||
    joint.a !== spec.groundedInstanceId || joint.a === joint.b) {
    return reject("A grounded revolute joint with two local frames and a declared degree range is required.");
  }
  const moving = spec.instances.find(instance => instance.id === joint.b);
  const grounded = spec.instances.find(instance => instance.id === joint.a);
  if (!moving || !grounded || joint.range.min > -request.rotationDeg || joint.range.max < request.rotationDeg) {
    return reject("The symmetric sample angles exceed the declared joint range or use unknown instances.");
  }
  if (spec.connections.some(other => other.id !== joint.id &&
    other.type !== "fixed" && (other.a === moving.id || other.b === moving.id))) {
    return reject("The selected moving instance has other articulated joints; single-axis replay would be incomplete.");
  }
  for (const motion of spec.motions.filter(motion => motion.inputConnectionId === joint.id)) {
    if (motion.range.unit !== "deg" || motion.range.min > -request.rotationDeg || motion.range.max < request.rotationDeg) {
      return reject("The requested samples exceed a declared input motion range.");
    }
  }
  const matchingFrames = checkDeclaredJointFrames({
    spec, maxAxisOffsetMm: 0.1, maxAngleDegrees: 0.1,
  }).find(check => check.connectionId === joint.id);
  if (matchingFrames?.status !== "PASS") return reject("The two declared joint axes are not coherent at the starting pose.");

  const m = grounded.transform;
  const p = joint.frameA.origin, d = joint.frameA.direction;
  const origin: [number, number, number] = [
    m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],
    m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],
    m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11],
  ];
  const rotated = [
    m[0]*d[0]+m[1]*d[1]+m[2]*d[2],
    m[4]*d[0]+m[5]*d[1]+m[6]*d[2],
    m[8]*d[0]+m[9]*d[1]+m[10]*d[2],
  ];
  const length = Math.hypot(...rotated);
  if (!(length > 0)) return reject("No usable grounded rotation axis.");
  const direction: [number, number, number] = [rotated[0]/length,rotated[1]/length,rotated[2]/length];
  const sampleCount = request.sampleCount ?? 3;
  const sampleAngles = Array.from({length:sampleCount},(_,i)=> {
    const angle = request.rotationDeg * (2*i/(sampleCount-1)-1);
    // Preserve exactly zero in the central sample for numerical evidence.
    return i===(sampleCount-1)/2 ? 0 : angle;
  });
  const samples = sampleAngles.map((angle): SourcePoseSample => ({
    id: sampleCount===3 ? (angle < 0 ? "negative" : angle > 0 ? "positive" : "zero") : "pose" + sampleAngles.indexOf(angle),
    parameters: { [request.sourceParameter]: angle },
    transforms: {
      [moving.id]: multiplyMatrices(rotationAboutAxis(origin, direction, angle * Math.PI / 180), moving.transform),
    },
  }));
  return {
    request,
    binding: {
      connectionId: joint.id, sourceParameter: request.sourceParameter,
      movingInstanceId: moving.id, groundedInstanceId: grounded.id,
      rotationDeg: request.rotationDeg,
      sampleCount,
      maximumSampleAngleGapDeg: 2 * request.rotationDeg/(sampleCount-1),
      axis: { origin, direction }, samples, sourceBindingConfirmedByUser: true,
    },
  };
}
