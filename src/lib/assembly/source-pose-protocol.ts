import { buildHingeSourceProtocol } from "./source-motion-protocol";
import { automaticSliderCrankKinematics } from "./automatic-slider-crank";
import { buildSliderCrankSourcePoseProtocolFromSpec } from "../tools/slider-crank-source-pose";
import { validateAssemblySpec } from "./assembly-spec";

/**
 * Chooses the source-pose protocol a declared assembly can actually support.
 * The hinge protocol stays first; a recognized slider-crank gets quintile
 * angles inside its declared range. Expectations come from the declared
 * frames through the canonical analytic builder, not from the model's source
 * assignments. A seed-derived challenge angle is not added here yet.
 */
export function buildSourcePoseProtocol(specInput: unknown, challengeSeed?: string) {
  const parsed = validateAssemblySpec(specInput);
  if (!parsed.success) return { status: "NOT_RUN" as const, reason: "Invalid assembly specification." };
  const spec = parsed.data;
  const hinge = buildHingeSourceProtocol(spec, challengeSeed);
  if (hinge.status === "READY") return hinge;
  const kinematics = automaticSliderCrankKinematics(spec);
  if (!kinematics) return hinge;
  const motion = spec.motions.find((item) => item.inputConnectionId === kinematics.crankAxisConnectionId);
  const range = motion?.range;
  if (!range || range.unit !== "deg" || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min)
    return hinge;
  const span = range.max - range.min;
  const anglesDeg = [0, 0.2, 0.4, 0.6, 0.8].map((fraction) => range.min + span * fraction);
  const built = buildSliderCrankSourcePoseProtocolFromSpec({ spec, anglesDeg, budgetMs: 90000 });
  if (built.status !== "READY") return built;
  return {
    status: "READY" as const,
    connectionId: built.connectionId,
    protocol: built.protocol,
    sampling: {
      method: "slider-crank-range-quintiles/v1",
      challengeSeed: null,
      coverage: `Five listed inputs inside ${range.min}° to ${range.max}°; every listed input requires complete bidirectional surface correspondence, and the same-input assembly view must reconstruct. Finite inputs cannot certify a continuous relation or an unlisted phase.`,
    },
    reason: "The declared four-instance slider-crank has a canonical frame and source binding; five range inputs were listed for complete surface comparison.",
  };
}
