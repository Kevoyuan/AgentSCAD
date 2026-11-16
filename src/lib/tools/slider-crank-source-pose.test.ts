import { expect, test } from "bun:test";
import type { AssemblySpec } from "../assembly/assembly-spec";
import { buildSliderCrankSourcePoseProtocol, sliderCrankAnalyticPose } from "./slider-crank-source-pose";

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
