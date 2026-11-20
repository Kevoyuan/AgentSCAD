import { validateAssemblySpec, type AssemblySpec } from "./assembly-spec";

/**
 * Recognizes a four-instance, grounded slider-crank: frame–crank revolute,
 * crank–rod revolute, rod–slider revolute, slider–frame prismatic. Every
 * connection needs frames on both sides, and the single motion must drive the
 * grounded revolute with a source binding. The result is a declaration reading,
 * not proof that the rendered geometry satisfies it.
 */
export interface AutomaticSliderCrankKinematics {
  frameInstanceId: string;
  crankInstanceId: string;
  rodInstanceId: string;
  sliderInstanceId: string;
  /** Grounded revolute that is the mechanism input. */
  crankAxisConnectionId: string;
  crankPinConnectionId: string;
  wristConnectionId: string;
  slideConnectionId: string;
}

export function automaticSliderCrankKinematics(specInput: unknown): AutomaticSliderCrankKinematics | null {
  const parsed = validateAssemblySpec(specInput);
  if (!parsed.success) return null;
  const spec: AssemblySpec = parsed.data;
  if (spec.instances.length !== 4 || spec.connections.length !== 4) return null;
  if (!spec.groundedInstanceId) return null;
  const grounded = spec.groundedInstanceId;
  const revolute = spec.connections.filter((connection) => connection.type === "revolute");
  const prismatic = spec.connections.filter((connection) => connection.type === "prismatic");
  if (revolute.length !== 3 || prismatic.length !== 1) return null;
  const other = (connection: AssemblySpec["connections"][number], endpoint: string) =>
    connection.a === endpoint ? connection.b : connection.b === endpoint ? connection.a : null;
  const sliderId = other(prismatic[0], grounded);
  if (!sliderId) return null;
  const crankAxis = revolute.find((connection) => {
    const partner = other(connection, grounded);
    return partner !== null && partner !== sliderId;
  });
  if (!crankAxis) return null;
  const crankId = other(crankAxis, grounded)!;
  const crankPin = revolute.find((connection) => connection.id !== crankAxis.id
    && (connection.a === crankId || connection.b === crankId));
  if (!crankPin) return null;
  const rodId = other(crankPin, crankId);
  if (!rodId || rodId === grounded || rodId === sliderId) return null;
  const wrist = revolute.find((connection) => connection.id !== crankAxis.id && connection.id !== crankPin.id
    && ((connection.a === rodId && connection.b === sliderId) || (connection.a === sliderId && connection.b === rodId)));
  if (!wrist) return null;
  if (new Set([grounded, crankId, rodId, sliderId]).size !== 4) return null;
  for (const connection of [crankAxis, crankPin, wrist, prismatic[0]]) {
    if (!connection.frameA || !connection.frameB) return null;
  }
  if (spec.motions.length !== 1 || spec.motions[0].inputConnectionId !== crankAxis.id
    || !spec.motions[0].sourceInput) return null;
  return {
    frameInstanceId: grounded,
    crankInstanceId: crankId,
    rodInstanceId: rodId,
    sliderInstanceId: sliderId,
    crankAxisConnectionId: crankAxis.id,
    crankPinConnectionId: crankPin.id,
    wristConnectionId: wrist.id,
    slideConnectionId: prismatic[0].id,
  };
}
