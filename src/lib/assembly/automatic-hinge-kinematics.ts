import type { AssemblySpec } from "./assembly-spec";

/**
 * Automatic rigid sampling is scoped to one independently moving body. A more
 * complex graph needs an explicit moving group and a solved sign convention.
 */
export function automaticHingeKinematics(spec: AssemblySpec): { connectionId: string; movingInstanceIds: string[] } | undefined {
  if (spec.instances.length !== 2 || spec.connections.length !== 1) return undefined;
  const connection = spec.connections[0];
  if (connection.type !== "revolute" || spec.groundedInstanceId !== connection.a) return undefined;
  if (!spec.instances.some(instance => instance.id === connection.a)
      || !spec.instances.some(instance => instance.id === connection.b)) return undefined;
  return { connectionId: connection.id, movingInstanceIds: [connection.b] };
}
