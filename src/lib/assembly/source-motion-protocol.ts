import type { AssemblySpec } from "./assembly-spec";
import { automaticHingeKinematics } from "./automatic-hinge-kinematics";
import { multiplyMatrices, rotationAboutAxis } from "./path-and-motion";
import { transformPoint } from "../geometry/mesh-collision";
import type { Vec3 } from "../geometry/stl-mesh";
import type { verifySourcePoses } from "../tools/source-pose-verification";

/** The binding proposes controls. Expectations come from the frozen joint and
 * instance poses, whose actual mating axes are checked separately by the caller.
 * This first automatic solver covers one grounded two-body revolute joint.
 */
export function buildHingeSourceProtocol(spec: AssemblySpec) {
  const unavailable = (reason: string) => ({ status: "NOT_RUN" as const, reason });
  const hinge = automaticHingeKinematics(spec);
  if (!hinge || spec.motions.length !== 1) return unavailable("Automatic source motion requires one grounded two-body hinge and one motion");
  const connection = spec.connections[0], motion = spec.motions[0];
  if (!motion.sourceInput) return unavailable("The motion has no source parameter and instance-view binding");
  if (motion.inputConnectionId !== connection.id || !connection.frameA || !connection.range
    || motion.range.unit !== "deg" || connection.range.unit !== "deg"
    || motion.range.min !== connection.range.min || motion.range.max !== connection.range.max
    || !Number.isFinite(motion.range.max - motion.range.min)
    || motion.range.min > 0 || motion.range.max < 0 || motion.range.min === motion.range.max)
    return unavailable("Source motion needs matching nonzero degree ranges containing the declared zero pose");
  const grounded = spec.instances.find(instance => instance.id === connection.a)!;
  const origin = transformPoint(grounded.transform, connection.frameA.origin);
  const localDirection = connection.frameA.direction;
  const direction = [0, 1, 2].map(k => grounded.transform[k * 4] * localDirection[0]
    + grounded.transform[k * 4 + 1] * localDirection[1]
    + grounded.transform[k * 4 + 2] * localDirection[2]) as Vec3;
  const angles = [...new Set([0, ...Array.from({ length: 5 }, (_, i) =>
    motion.range.min + (motion.range.max - motion.range.min) * i / 4)])].sort((a, b) => a - b);
  const protocol: Omit<Parameters<typeof verifySourcePoses>[0], "scadSource" | "spec"> = {
    poseSelectors: { ...motion.sourceInput.poseSelectors },
    manufacturingParameters: { agentscad_pose: false, [motion.sourceInput.parameter]: 0 },
    poseParameters: { agentscad_pose: true }, surfaceComparison: "bounded-cover", budgetMs: 90000,
    cases: angles.map((angle, index) => {
      const rotation = rotationAboutAxis(origin, direction, angle * Math.PI / 180);
      return { id: `angle-${index}`, parameters: { [motion.sourceInput!.parameter]: angle },
        transforms: Object.fromEntries(spec.instances.map(instance => [instance.id,
          instance.id === connection.b ? multiplyMatrices(rotation, instance.transform) : [...instance.transform]])) };
    })
  };
  return { status: "READY" as const, connectionId: connection.id, protocol,
    reason: "Frozen zero pose and range quartiles only. Measured-axis prerequisite and same-input assembly comparison remain required" };
}
