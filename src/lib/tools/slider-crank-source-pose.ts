import type { AssemblySpec } from "../assembly/assembly-spec";
import { multiplyMatrices, rotationAboutAxis, translationMatrix } from "../assembly/path-and-motion";
import type { verifySourcePoses } from "./source-pose-verification";
import { automaticSliderCrankKinematics } from "../assembly/automatic-slider-crank";

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

/** Canonical, axis-aligned variant driven entirely by a declared assembly spec. */
export interface SliderCrankSpecProtocolInput {
  spec: AssemblySpec;
  /** Five or more crank angles in degrees, sampled inside the declared range. */
  anglesDeg: number[];
  budgetMs?: number;
}

export type SliderCrankSpecProtocol =
  | { status: "READY"; connectionId: string; roles: { frame: string; crank: string; rod: string; slider: string };
      crankRadiusMm: number; rodLengthMm: number; protocol: SliderCrankSourceProtocol }
  | { status: "NOT_RUN"; reason: string };

const COLUMN = (matrix: number[], column: number) => [matrix[column], matrix[4 + column], matrix[8 + column]] as [number, number, number];
function applyPoint(matrix: number[], point: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((row) => matrix[row * 4] * point[0] + matrix[row * 4 + 1] * point[1]
    + matrix[row * 4 + 2] * point[2] + matrix[row * 4 + 3]) as [number, number, number];
}
function applyDirection(matrix: number[], direction: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((row) => matrix[row * 4] * direction[0] + matrix[row * 4 + 1] * direction[1]
    + matrix[row * 4 + 2] * direction[2]) as [number, number, number];
}
const near = (actual: number, expected: number, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance;
const pointNear = (a: number[], b: number[], tolerance = 1e-6) => a.length === b.length && a.every((value, index) => near(value, b[index], tolerance));
const frameFor = (connection: AssemblySpec["connections"][number], instanceId: string) =>
  connection.a === instanceId ? connection.frameA : connection.frameB;
const otherEndpoint = (connection: AssemblySpec["connections"][number], instanceId: string) =>
  connection.a === instanceId ? connection.b : connection.a;

/**
 * Builds the canonical (crank axis +Y through the origin, slider axis +Z)
 * protocol from a declared four-instance assembly. The declaration supplies the
 * radius and rod length through its own connection frames; the builder only
 * accepts a declaration whose assembled pose already matches that construction,
 * so a mismatched declaration is refused rather than silently interpreted.
 */
export function buildSliderCrankSourcePoseProtocolFromSpec(input: SliderCrankSpecProtocolInput): SliderCrankSpecProtocol {
  const kinematics = automaticSliderCrankKinematics(input.spec);
  if (!kinematics) return { status: "NOT_RUN", reason: "The declared assembly is not a four-instance grounded slider-crank." };
  const spec = input.spec;
  const motion = spec.motions.find((item) => item.inputConnectionId === kinematics.crankAxisConnectionId);
  if (!motion?.sourceInput) return { status: "NOT_RUN", reason: "The input revolute motion has no source parameter and pose-selector binding." };
  if (!Array.isArray(input.anglesDeg) || input.anglesDeg.length < 2 || input.anglesDeg.length > 32
    || input.anglesDeg.some((angle) => !Number.isFinite(angle)) || new Set(input.anglesDeg).size !== input.anglesDeg.length)
    return { status: "NOT_RUN", reason: "The protocol needs 2 to 32 distinct finite crank angles." };
  const frame = spec.instances.find((item) => item.id === kinematics.frameInstanceId)!;
  const crank = spec.instances.find((item) => item.id === kinematics.crankInstanceId)!;
  const rod = spec.instances.find((item) => item.id === kinematics.rodInstanceId)!;
  const slider = spec.instances.find((item) => item.id === kinematics.sliderInstanceId)!;
  const byId = (id: string) => spec.connections.find((connection) => connection.id === id)!;
  const crankAxis = byId(kinematics.crankAxisConnectionId);
  const crankPin = byId(kinematics.crankPinConnectionId);
  const wrist = byId(kinematics.wristConnectionId);
  const slide = byId(kinematics.slideConnectionId);
  const axisFrame = frameFor(crankAxis, frame.id);
  const slideFrame = frameFor(slide, frame.id);
  if (!axisFrame || !slideFrame) return { status: "NOT_RUN", reason: "Both the input revolute and the prismatic slide need a frame on the grounded instance." };
  const axisDirection = applyDirection(frame.transform, axisFrame.direction);
  const slideDirection = applyDirection(frame.transform, slideFrame.direction);
  if (!pointNear(axisDirection, [0, 1, 0]) || !pointNear(slideDirection, [0, 0, 1]))
    return { status: "NOT_RUN", reason: "The spec-derived protocol currently supports only a +Y crank axis and +Z slider axis." };
  const axisOrigin = applyPoint(frame.transform, axisFrame.origin);
  if (!pointNear(axisOrigin, [0, 0, 0])) return { status: "NOT_RUN", reason: "The crank axis must pass through the assembly origin for the canonical protocol." };
  const crankPinFrame = frameFor(crankPin, crank.id);
  const wristFrame = frameFor(wrist, rod.id);
  if (!crankPinFrame || !wristFrame) return { status: "NOT_RUN", reason: "The crank-rod and rod-slider joints need frames on the moving parts." };
  const pinWorld = applyPoint(crank.transform, crankPinFrame.origin);
  const wristWorld = applyPoint(rod.transform, wristFrame.origin);
  const radius = Math.hypot(pinWorld[0], pinWorld[1], pinWorld[2]);
  const rodLength = Math.hypot(wristWorld[0] - pinWorld[0], wristWorld[1] - pinWorld[1], wristWorld[2] - pinWorld[2]);
  if (!(radius > 1e-6) || !(rodLength > radius)) return { status: "NOT_RUN", reason: "The declared crank radius or rod length cannot form the canonical closed loop." };
  // The declared assembled pose must be the zero-angle construction the source renders.
  if (!pointNear(pinWorld, [0, 0, radius], 1e-5) || !pointNear(wristWorld, [0, 0, radius + rodLength], 1e-5)
    || !pointNear(rod.transform, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, radius, 0, 0, 0, 1], 1e-5)
    || !pointNear(slider.transform, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, radius + rodLength, 0, 0, 0, 1], 1e-5))
    return { status: "NOT_RUN", reason: "The declared instance poses do not match the canonical zero-angle slider-crank construction." };
  const poses = input.anglesDeg.map((angleDeg) => sliderCrankAnalyticPose({ crankRadiusMm: radius, rodLengthMm: rodLength, angleDeg }));
  const transformsOf = (pose: SliderCrankAnalyticPose) => ({
    [frame.id]: [...frame.transform], [crank.id]: pose.crank,
    [rod.id]: pose.rod, [slider.id]: pose.slider,
  });
  return {
    status: "READY",
    connectionId: kinematics.crankAxisConnectionId,
    roles: { frame: frame.id, crank: crank.id, rod: rod.id, slider: slider.id },
    crankRadiusMm: radius, rodLengthMm: rodLength,
    protocol: {
      poseSelectors: { ...motion.sourceInput.poseSelectors },
      manufacturingParameters: { agentscad_pose: false, [motion.sourceInput.parameter]: 0 },
      poseParameters: { agentscad_pose: true },
      cases: poses.map((pose, index) => ({ id: `angle-${index}`, parameters: { [motion.sourceInput!.parameter]: pose.angleDeg }, transforms: transformsOf(pose) })),
      budgetMs: input.budgetMs ?? 120000,
      surfaceComparison: "bounded-cover",
    },
  };
}
