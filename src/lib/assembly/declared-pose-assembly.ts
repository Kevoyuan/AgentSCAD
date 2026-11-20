import { validateAssemblySpec } from "./assembly-spec";
import { assemblySpecificationHash } from "./spec-hash";
import { checkDeclaredPoseDisassembly } from "./declared-pose-disassembly";

/**
 * Check the explicitly declared rigid assembly sequence, using its reverse as
 * a collision-equivalent removal sequence. Before an insertion, only the base
 * and previously inserted instances exist in the scene. Reversing BOTH the
 * operation order and each path gives exactly that same obstacle inventory.
 * This proves sampled rigid geometric feasibility, never physical reversibility.
 */
export function checkDeclaredPoseAssembly(input: Parameters<typeof checkDeclaredPoseDisassembly>[0]) {
  const started = performance.now();
  const parsed = validateAssemblySpec(input.spec);
  if (!parsed.success) throw new Error("Invalid assembly specification");
  const spec = parsed.data;
  const operations = spec.operations.filter(operation => operation.action === "assemble");
  const base = {
    method: "declared-assembly-via-reversed-removal/v1",
    specificationSha256: assemblySpecificationHash(spec),
    declaredOperationOrder: operations.map(operation => operation.id),
    declaredRigidTrajectories:operations.filter(operation=>operation.rigidTrajectory).map(operation=>({operationId:operation.id,declaration:operation.rigidTrajectory})),
    evaluationOrder: "reverse of the declared assembly order",
    coverage: "Only declared rigid sampled poses, with the grounded base and previously installed instances as obstacles. Incoming parts start in external storage. No continuous clearance, transport, support, tool access, friction, compliance or physical reversibility was checked.",
  };
  if (!spec.groundedInstanceId) return { ...base, status: "NOT_RUN" as const, reason: "No grounded instance was declared" };
  if (!operations.length) return { ...base, status: "NOT_RUN" as const, reason: "No assembly operations were declared" };
  const expected = spec.instances.filter(instance => instance.id !== spec.groundedInstanceId).map(instance => instance.id).sort();
  if (JSON.stringify(expected) !== JSON.stringify(operations.map(operation => operation.instanceId).sort())) {
    return { ...base, status: "ERROR" as const, reason: "Every non-grounded instance must be installed exactly once" };
  }
  // The V1 screw representation binds its START to the assembled instance
  // transform. It cannot represent an external insertion start. Do not invent
  // that missing pose or silently reverse a disassembly-only screw declaration.
  if (operations.some(operation => operation.screwTrajectory)) {
    return { ...base, status: "NOT_RUN" as const, reason: "Assembly screw trajectories need an explicit external start pose; declare dense world-space waypoints instead" };
  }
  for (const operation of operations) {
    // This representation explicitly anchors the forward stages at the assembled
    // pose and declares reverse traversal for insertion. No external start is guessed.
    if(operation.rigidTrajectory)continue;
    const end = operation.waypoints.at(-1);
    const instance = spec.instances.find(instance => instance.id === operation.instanceId)!;
    if (!end || end.some((value, index) => Math.abs(value - instance.transform[index]) > 1e-6)) {
      return { ...base, status: "ERROR" as const, reason: `Operation ${operation.id} does not end at the declared assembly pose` };
    }
  }
  const reversed = {
    ...spec,
    operations: [...operations].reverse().map(operation => ({
      ...operation, action: "disassemble" as const, waypoints: [...operation.waypoints].reverse(),
      ...(operation.rigidTrajectory?{rigidTrajectory:{...operation.rigidTrajectory,traversal:"forward" as const}}:{}),
    })),
  };
  const checked = checkDeclaredPoseDisassembly({ ...input, spec: reversed });
  const elapsedMs = Math.round(performance.now() - started);
  const expired = checked.status === "PASS" && performance.now() - started > (input.budgetMs ?? 5000);
  return {
    ...base,
    status: expired ? "NOT_RUN" as const : checked.status,
    reason: expired ? "Assembly sequence exceeded its evaluation budget" : checked.status === "PASS"
      ? "Every declared insertion is clear at the sampled rigid poses and reaches its assembled pose"
      : "The declared assembly sequence is not verified: " + checked.reason,
    elapsedMs,
    reversedEvaluation: checked,
  };
}
