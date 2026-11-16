import type { AssemblySpec } from "../assembly/assembly-spec";
import { multiplyMatrices, rotationAboutAxis, translationMatrix } from "../assembly/path-and-motion";
import type { verifySourcePoses } from "./source-pose-verification";

/**
 * Independent analytic expectations for an in-plane slider-crank whose crank
 * rotates about world +Y and whose slider translates along world +Z.
 *
 * The formulas use the frozen crank radius and rod length only. They do not
 * read the SCAD source's own `cx`/`cz`/`travel` assignments: the source is what
 * gets measured, not the authority that defines the expected pose.
 */
export interface SliderCrankSourcePoseInput {
  spec: AssemblySpec;
  /** Instance ID for each kinematic role. */
  instances: { frame: string; crank: string; rod: string; slider: string };
  crankRadiusMm: number;
  rodLengthMm: number;
  /** Source parameter that drives the input angle, in degrees. */
  motionParameter: string;
  anglesDeg: number[];
  budgetMs?: number;
}

export type SliderCrankSourceProtocol = Omit<Parameters<typeof verifySourcePoses>[0], "scadSource" | "spec">;

export interface SliderCrankAnalyticPose {
  angleDeg: number;
  crank: number[];
  rod: number[];
  slider: number[];
  /** Crank-pin centre and slider-pin centre in the XZ plane. */
  crankPinXZ: [number, number];
  sliderPinXZ: [number, number];
  rodAngleDeg: number;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Closed-form in-plane slider-crank poses at one crank angle. */
export function sliderCrankAnalyticPose(input: {
  crankRadiusMm: number; rodLengthMm: number; angleDeg: number;
}): SliderCrankAnalyticPose {
  const { crankRadiusMm: radius, rodLengthMm: rodLength, angleDeg } = input;
  if (!(radius > 0) || !Number.isFinite(radius)) throw new Error("Crank radius must be finite and positive");
  if (!(rodLength > 0) || !Number.isFinite(rodLength)) throw new Error("Rod length must be finite and positive");
  if (!Number.isFinite(angleDeg)) throw new Error("Crank angle must be finite");
  const radians = angleDeg * Math.PI / 180;
  const pinX = radius * Math.sin(radians);
  const pinZ = radius * Math.cos(radians);
  const horizontal = rodLength * rodLength - pinX * pinX;
  if (!(horizontal > 0)) throw new Error("Crank radius exceeds rod length at this angle; the closed loop is impossible");
  const travel = Math.sqrt(horizontal);
  const sliderPinZ = pinZ + travel;
  const rodAngleDeg = Math.atan2(-pinX, travel) * 180 / Math.PI;
  const rodAngleRad = rodAngleDeg * Math.PI / 180;
  return {
    angleDeg,
    crank: rotationAboutAxis([0, 0, 0], [0, 1, 0], radians),
    rod: multiplyMatrices(translationMatrix([pinX, 0, pinZ]), rotationAboutAxis([0, 0, 0], [0, 1, 0], rodAngleRad)),
    slider: translationMatrix([0, 0, sliderPinZ]),
    crankPinXZ: [pinX, pinZ],
    sliderPinXZ: [0, sliderPinZ],
    rodAngleDeg,
  };
}

const reserved = new Set(["agentscad_part", "agentscad_pose"]);
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Builds a source-pose protocol for one grounded frame, crank, connecting rod
 * and slider. The expected transforms come from `sliderCrankAnalyticPose`;
 * the source parameter and pose selectors only identify what to render.
 */
export function buildSliderCrankSourcePoseProtocol(input: SliderCrankSourcePoseInput): SliderCrankSourceProtocol {
  if (!identifier.test(input.motionParameter) || reserved.has(input.motionParameter))
    throw new Error("The motion parameter must be a safe, non-reserved SCAD identifier");
  if (!Array.isArray(input.anglesDeg) || input.anglesDeg.length < 2 || input.anglesDeg.length > 32)
    throw new Error("A slider-crank source protocol needs 2 to 32 angles");
  if (!input.anglesDeg.every(Number.isFinite)) throw new Error("Every crank angle must be finite");
  if (new Set(input.anglesDeg).size !== input.anglesDeg.length) throw new Error("Crank angles must be distinct");
  const instanceIds = Object.values(input.instances);
  if (new Set(instanceIds).size !== 4) throw new Error("The four slider-crank roles need four distinct instances");
  for (const instanceId of instanceIds) {
    if (!input.spec.instances.some((instance) => instance.id === instanceId))
      throw new Error(`Unknown slider-crank instance: ${instanceId}`);
  }
  const poseSelectors = Object.fromEntries(([
    [input.instances.frame, "frame"], [input.instances.crank, "crank"],
    [input.instances.rod, "rod"], [input.instances.slider, "slider"],
  ] as const).map(([instanceId]) => {
    const instance = input.spec.instances.find((item) => item.id === instanceId)!;
    const part = input.spec.parts.find((item) => item.id === instance.partId);
    if (!part) throw new Error(`The slider-crank instance ${instanceId} has no declared part`);
    return [instanceId, part.selector];
  }));
  if (new Set(Object.values(poseSelectors)).size !== instanceIds.length)
    throw new Error("Every slider-crank role needs a distinct pose selector");
  const cases = input.anglesDeg.map((angleDeg) => {
    const pose = sliderCrankAnalyticPose({ crankRadiusMm: input.crankRadiusMm, rodLengthMm: input.rodLengthMm, angleDeg });
    return {
      id: `angle-${angleDeg}`,
      parameters: { [input.motionParameter]: angleDeg },
      transforms: {
        [input.instances.frame]: [...IDENTITY],
        [input.instances.crank]: pose.crank,
        [input.instances.rod]: pose.rod,
        [input.instances.slider]: pose.slider,
      },
    };
  });
  return {
    poseSelectors,
    manufacturingParameters: { agentscad_pose: false, [input.motionParameter]: 0 },
    poseParameters: { agentscad_pose: true },
    cases,
    budgetMs: input.budgetMs ?? 120000,
    surfaceComparison: "bounded-cover",
  };
}
