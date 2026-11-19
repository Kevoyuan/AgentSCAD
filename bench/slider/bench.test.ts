import { describe, expect, test } from "bun:test";
import { expectedOutcome } from "../assembly/bench";
import { validateSliderTask } from "./bench";

const baseTask = {
  schemaVersion: 1,
  id: "slider-unit",
  prompt: "做一个曲柄半径 8 mm、连杆 28 mm 的单缸曲柄滑块。",
  selectors: { crank: "crank", rod: "rod", slider: "slider", frame: "frame" },
  motionParameter: "motion_angle",
  poseParameters: { agentscad_pose: true },
  angles: [0, 90, 180, 270, 360],
  contract: {
    crankRadiusMm: 8,
    rodLengthMm: 28,
    toleranceMm: 0.02,
    sectionYmm: 2.3,
    axisProbeMm: 1,
    pinRadiusMm: { min: 1.98, max: 2.02 },
    rodBoreRadiusMm: { min: 2.18, max: 2.22 },
  },
  requirements: [
    { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 4 } },
    { id: "measured-joint-frames", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } },
    { id: "sampled-motion", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } },
    { id: "source-motion", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } },
  ],
};

describe("slider-crank benchmark task", () => {
  test("accepts a well-formed task", () => {
    expect(validateSliderTask(baseTask).id).toBe("slider-unit");
  });

  test("rejects a missing or duplicate selector and a missing assembled pose", () => {
    expect(() => validateSliderTask({ ...baseTask, selectors: { crank: "crank", rod: "rod", slider: "slider" } })).toThrow(/exactly crank/);
    expect(() => validateSliderTask({ ...baseTask, selectors: { ...baseTask.selectors, frame: "crank" } })).toThrow(/distinct/);
    expect(() => validateSliderTask({ ...baseTask, angles: [90, 180, 270] })).toThrow(/include 0/);
  });

  test("rejects an invalid mechanism contract", () => {
    expect(() => validateSliderTask({ ...baseTask, contract: { ...baseTask.contract, toleranceMm: 1e-6 } })).toThrow(/1e-4/);
    expect(() => validateSliderTask({ ...baseTask, contract: { ...baseTask.contract, pinRadiusMm: { min: 3, max: 2 } } })).toThrow(/min <= max/);
  });

  test("rejects an unobservable requirement and a distinct-parts count other than 4", () => {
    const requirements = [...baseTask.requirements, { id: "diametral-clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: 2 } }];
    expect(() => validateSliderTask({ ...baseTask, requirements })).toThrow(/no observer/);
    const wrongCount = baseTask.requirements.map((requirement) =>
      requirement.id === "distinct-exported-parts" ? { ...requirement, expected: { kind: "equals", value: 3 } } : requirement);
    expect(() => validateSliderTask({ ...baseTask, requirements: wrongCount })).toThrow(/distinct-exported-parts = 4/);
  });

  test("keeps the reference/adversarial/model expectation rule", () => {
    expect(expectedOutcome("reference")).toBe("pass");
    expect(expectedOutcome("adversarial-crank-radius")).toBe("fail");
    expect(expectedOutcome("model-deepseek-v4-flash")).toBe("unscored");
  });
});
