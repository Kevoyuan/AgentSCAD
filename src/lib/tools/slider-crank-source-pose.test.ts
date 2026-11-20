import { expect, test } from "bun:test";
import type { AssemblySpec } from "../assembly/assembly-spec";
import { buildSliderCrankSourcePoseProtocol, buildSliderCrankSourcePoseProtocolFromSpec, sliderCrankAnalyticPose } from "./slider-crank-source-pose";
import { automaticSliderCrankKinematics } from "../assembly/automatic-slider-crank";
import { buildSourcePoseProtocol } from "../assembly/source-pose-protocol";

const identity: AssemblySpec["instances"][number]["transform"] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function sliderSpec(): AssemblySpec {
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: ["frame", "crank", "rod", "slider"].map((id) => ({ id, name: id, selector: id, source: "generated" as const, material: null })),
    instances: ["frame1:frame", "crank1:crank", "rod1:rod", "slider1:slider"].map((pair) => {
      const [id, partId] = pair.split(":");
      return { id, partId, subassemblyId: null, transform: identity };
    }),
    subassemblies: [], connections: [], groundedInstanceId: "frame1", motions: [], operations: [],
    manufacturing: null, assumptions: [], unknowns: [],
  };
}
const close = (actual: number, expected: number, tolerance = 1e-6) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

test("analytic slider-crank poses close the loop and follow the frozen dimensions", () => {
  const atZero = sliderCrankAnalyticPose({ crankRadiusMm: 8, rodLengthMm: 28, angleDeg: 0 });
  expect(atZero.crankPinXZ).toEqual([0, 8]);
  expect(atZero.sliderPinXZ).toEqual([0, 36]);
  expect(atZero.rodAngleDeg).toBeCloseTo(0, 12);
  close(atZero.rod[11], 8);

  const atNinety = sliderCrankAnalyticPose({ crankRadiusMm: 8, rodLengthMm: 28, angleDeg: 90 });
  close(atNinety.crankPinXZ[0], 8);
  close(atNinety.crankPinXZ[1], 0);
  const travel = Math.sqrt(28 * 28 - 8 * 8);
  close(atNinety.sliderPinXZ[1], travel);
  close(atNinety.rodAngleDeg, Math.atan2(-8, travel) * 180 / Math.PI);
  // Row-major R_y(90): x' = z, z' = -x.
  close(atNinety.crank[0], 0); close(atNinety.crank[2], 1);
  close(atNinety.crank[8], -1); close(atNinety.crank[10], 0);
  // Rod pin at the crank pin, rod tip at the slider pin.
  close(atNinety.rod[3], 8); close(atNinety.rod[11], 0);
  close(atNinety.slider[11], travel);

  for (const angle of [0, 30, 60, 120, 180, 240, 300, 359]) {
    const pose = sliderCrankAnalyticPose({ crankRadiusMm: 8, rodLengthMm: 28, angleDeg: angle });
    const tipX = pose.rod[2] * 28 + pose.rod[3];
    const tipZ = pose.rod[10] * 28 + pose.rod[11];
    close(tipX, pose.sliderPinXZ[0]);
    close(tipZ, pose.sliderPinXZ[1]);
  }
});

test("the protocol names every role and records all expected transforms", () => {
  const spec = sliderSpec();
  const protocol = buildSliderCrankSourcePoseProtocol({
    spec, instances: { frame: "frame1", crank: "crank1", rod: "rod1", slider: "slider1" },
    crankRadiusMm: 8, rodLengthMm: 28, motionParameter: "motion_angle", anglesDeg: [0, 90], budgetMs: 5000,
  });
  expect(protocol.poseSelectors).toEqual({ frame1: "frame", crank1: "crank", rod1: "rod", slider1: "slider" });
  expect(protocol.manufacturingParameters).toEqual({ agentscad_pose: false, motion_angle: 0 });
  expect(protocol.poseParameters).toEqual({ agentscad_pose: true });
  expect(protocol.cases).toHaveLength(2);
  expect(protocol.cases[1].parameters).toEqual({ motion_angle: 90 });
  expect(Object.keys(protocol.cases[0].transforms).sort()).toEqual(["crank1", "frame1", "rod1", "slider1"]);
  expect(protocol.budgetMs).toBe(5000);
  expect(protocol.surfaceComparison).toBe("bounded-cover");
});

test("invalid protocols are refused before any render", () => {
  const spec = sliderSpec();
  const base = {
    spec, instances: { frame: "frame1", crank: "crank1", rod: "rod1", slider: "slider1" },
    crankRadiusMm: 8, rodLengthMm: 28, motionParameter: "motion_angle", anglesDeg: [0, 90],
  };
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, anglesDeg: [90, 90] })).toThrow(/distinct/);
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, anglesDeg: [0] })).toThrow(/2 to 32/);
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, motionParameter: "agentscad_pose" })).toThrow(/reserved/);
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, instances: { ...base.instances, frame: "missing" } })).toThrow(/Unknown/);
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, instances: { ...base.instances, frame: "crank1" } })).toThrow(/distinct/);
  expect(() => sliderCrankAnalyticPose({ crankRadiusMm: 40, rodLengthMm: 28, angleDeg: 90 })).toThrow(/impossible/);
  const duplicateSelectors: AssemblySpec = {
    ...spec, parts: spec.parts.map((part) => ({ ...part, selector: "same" })),
  };
  expect(() => buildSliderCrankSourcePoseProtocol({ ...base, spec: duplicateSelectors })).toThrow(/distinct pose selector/);
});

function declaredSliderCrank(): AssemblySpec {
  const transform = (z: number): AssemblySpec["instances"][number]["transform"] =>
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1];
  return {
    schemaVersion: 1, units: "mm", coordinateSystem: "right-handed",
    parts: ["frame", "crank", "rod", "slider"].map((id) => ({ id, name: id, selector: id, source: "generated" as const, material: null })),
    instances: [
      { id: "frame1", partId: "frame", subassemblyId: null, transform: transform(0) },
      { id: "crank1", partId: "crank", subassemblyId: null, transform: transform(0) },
      { id: "rod1", partId: "rod", subassemblyId: null, transform: transform(8) },
      { id: "slider1", partId: "slider", subassemblyId: null, transform: transform(36) },
    ],
    subassemblies: [],
    connections: [
      { id: "crank_axis", type: "revolute", a: "frame1", b: "crank1",
        frameA: { origin: [0, 0, 0], direction: [0, 1, 0] }, frameB: { origin: [0, 0, 0], direction: [0, 1, 0] },
        range: { min: 0, max: 360, unit: "deg" }, pitchMm: null, ratio: null, allowedContact: [] },
      { id: "crank_pin", type: "revolute", a: "crank1", b: "rod1",
        frameA: { origin: [0, 0, 8], direction: [0, 1, 0] }, frameB: { origin: [0, 0, 0], direction: [0, 1, 0] },
        range: null, pitchMm: null, ratio: null, allowedContact: [] },
      { id: "wrist", type: "revolute", a: "rod1", b: "slider1",
        frameA: { origin: [0, 0, 28], direction: [0, 1, 0] }, frameB: { origin: [0, 0, 0], direction: [0, 1, 0] },
        range: null, pitchMm: null, ratio: null, allowedContact: [] },
      { id: "slide", type: "prismatic", a: "slider1", b: "frame1",
        frameA: { origin: [0, 0, 0], direction: [0, 0, 1] }, frameB: { origin: [0, 0, 0], direction: [0, 0, 1] },
        range: null, pitchMm: null, ratio: null, allowedContact: [] },
    ],
    groundedInstanceId: "frame1",
    motions: [{
      id: "crank_motion", inputConnectionId: "crank_axis", range: { min: 0, max: 360, unit: "deg" },
      sourceInput: { parameter: "motion_angle", poseSelectors: { frame1: "frame", crank1: "crank", rod1: "rod", slider1: "slider" } },
    }],
    operations: [], manufacturing: null, assumptions: [], unknowns: [],
  };
}

test("a declared canonical slider-crank yields the analytic protocol", () => {
  const spec = declaredSliderCrank();
  const result = buildSliderCrankSourcePoseProtocolFromSpec({ spec, anglesDeg: [0, 90], budgetMs: 5000 });
  expect(result.status).toBe("READY");
  if (result.status !== "READY") return;
  expect(result.crankRadiusMm).toBeCloseTo(8, 9);
  expect(result.rodLengthMm).toBeCloseTo(28, 9);
  expect(result.connectionId).toBe("crank_axis");
  expect(result.roles).toEqual({ frame: "frame1", crank: "crank1", rod: "rod1", slider: "slider1" });
  expect(result.protocol.cases.map((item) => item.parameters)).toEqual([{ motion_angle: 0 }, { motion_angle: 90 }]);
  const ninety = sliderCrankAnalyticPose({ crankRadiusMm: 8, rodLengthMm: 28, angleDeg: 90 });
  expect(result.protocol.cases[1].transforms.crank1).toEqual(ninety.crank);
  expect(result.protocol.cases[1].transforms.rod1).toEqual(ninety.rod);
  expect(result.protocol.cases[1].transforms.slider1).toEqual(ninety.slider);
  expect(result.protocol.poseSelectors).toEqual({ frame1: "frame", crank1: "crank", rod1: "rod", slider1: "slider" });
});

test("a non-canonical or under-declared slider-crank is refused", () => {
  const spec = declaredSliderCrank();
  const wrongAxis: AssemblySpec = { ...spec, connections: spec.connections.map((connection) =>
    connection.id === "crank_axis" && connection.frameA
      ? { ...connection, frameA: { ...connection.frameA, direction: [1, 0, 0] as [number, number, number] } } : connection) };
  expect(buildSliderCrankSourcePoseProtocolFromSpec({ spec: wrongAxis, anglesDeg: [0, 90] }).status).toBe("NOT_RUN");
  const noBinding: AssemblySpec = { ...spec, motions: spec.motions.map((motion) => ({ ...motion, sourceInput: undefined })) };
  expect(buildSliderCrankSourcePoseProtocolFromSpec({ spec: noBinding, anglesDeg: [0, 90] }).status).toBe("NOT_RUN");
  const wrongPose: AssemblySpec = { ...spec, instances: spec.instances.map((instance) =>
    instance.id === "rod1" ? { ...instance, transform: identity } : instance) };
  expect(buildSliderCrankSourcePoseProtocolFromSpec({ spec: wrongPose, anglesDeg: [0, 90] }).status).toBe("NOT_RUN");
  expect(buildSliderCrankSourcePoseProtocolFromSpec({ spec, anglesDeg: [90, 90] }).status).toBe("NOT_RUN");
});


test("automatic detection names the four roles and refuses incomplete families", () => {
  const spec = declaredSliderCrank();
  expect(automaticSliderCrankKinematics(spec)).toMatchObject({
    frameInstanceId: "frame1", crankInstanceId: "crank1", rodInstanceId: "rod1", sliderInstanceId: "slider1",
    crankAxisConnectionId: "crank_axis", slideConnectionId: "slide",
  });
  const noBinding: AssemblySpec = { ...spec, motions: spec.motions.map((motion) => ({ ...motion, sourceInput: undefined })) };
  expect(automaticSliderCrankKinematics(noBinding)).toBeNull();
  const fifthPart: AssemblySpec = { ...spec, instances: [...spec.instances, { ...spec.instances[0], id: "frame2" }] };
  expect(automaticSliderCrankKinematics(fifthPart)).toBeNull();
  const wrongSlide: AssemblySpec = { ...spec, connections: spec.connections.map((connection) =>
    connection.id === "slide" ? { ...connection, type: "fixed" as const } : connection) };
  expect(automaticSliderCrankKinematics(wrongSlide)).toBeNull();
});

test("the dispatcher selects the hinge protocol first and the slider protocol for a declared family", () => {
  const slider = declaredSliderCrank();
  const dispatched = buildSourcePoseProtocol(slider, "0123456789abcdef0123456789abcdef");
  expect(dispatched.status).toBe("READY");
  if (dispatched.status !== "READY") return;
  expect(dispatched.connectionId).toBe("crank_axis");
  expect(dispatched.sampling.method).toBe("slider-crank-range-quintiles/v1");
  expect(dispatched.protocol.cases).toHaveLength(5);
  const unsupported: AssemblySpec = { ...slider, connections: [], motions: [] };
  expect(buildSourcePoseProtocol(unsupported).status).toBe("NOT_RUN");
});
