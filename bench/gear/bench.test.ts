import { describe, expect, test } from "bun:test";
import { expectedOutcome } from "../assembly/bench";
import { validateGearTask } from "./bench";

const baseTask = {
  schemaVersion: 1,
  id: "gear-unit",
  prompt: "做一个 12 齿与 24 齿的外啮合齿轮对，中心距 36 mm。",
  parts: [
    { id: "pinion", selector: "pinion_pose" },
    { id: "wheel", selector: "wheel_pose" },
  ],
  pinionPartId: "pinion",
  wheelPartId: "wheel",
  axisDirection: [0, 0, 1],
  pinion: { centerMm: [0, 0], toothCount: 12 },
  wheel: { centerMm: [36, 0], toothCount: 24 },
  ratio: -0.5,
  centerDistanceMm: 36,
  pose: {
    parameter: "input_deg",
    values: [0, 45, 90, 135, 180, 225, 270, 315],
    angleToleranceDeg: 0.5,
    ratioTolerance: 0.005,
    centerDistanceToleranceMm: 0.2,
  },
  requirements: [
    { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 2 } },
    { id: "rigid-motion", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } },
  ],
};

describe("gear-pair benchmark task", () => {
  test("accepts a well-formed task", () => {
    expect(validateGearTask(baseTask).id).toBe("gear-unit");
  });

  test("rejects a ratio that disagrees with the declared tooth counts", () => {
    expect(() => validateGearTask({ ...baseTask, ratio: -0.4 })).toThrow(/does not match/);
  });

  test("rejects a centre distance that disagrees with the declared centres", () => {
    expect(() => validateGearTask({ ...baseTask, centerDistanceMm: 40 })).toThrow(/distance between the declared centres/);
  });

  test("rejects a requirement with no observer in the gear scorer", () => {
    const requirements = [...baseTask.requirements, { id: "diametral-clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: 2 } }];
    expect(() => validateGearTask({ ...baseTask, requirements })).toThrow(/no observer/);
  });

  test("rejects a pose list that omits the assembled pose", () => {
    expect(() => validateGearTask({ ...baseTask, pose: { ...baseTask.pose, values: [45, 90, 135] } })).toThrow(/include 0/);
  });

  test("rejects a zero axis and equal tooth counts", () => {
    expect(() => validateGearTask({ ...baseTask, axisDirection: [0, 0, 0] })).toThrow(/non-zero/);
    expect(() => validateGearTask({ ...baseTask, wheel: { ...baseTask.wheel, toothCount: 12 } })).toThrow(/different tooth counts/);
  });

  test("keeps the reference/adversarial/model expectation rule", () => {
    expect(expectedOutcome("reference")).toBe("pass");
    expect(expectedOutcome("adversarial-same-direction")).toBe("fail");
    expect(expectedOutcome("model-deepseek-v4-flash")).toBe("unscored");
  });
});
