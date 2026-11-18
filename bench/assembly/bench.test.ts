import { describe, expect, test } from "bun:test";

import { aggregateStatus, expectedOutcome, validateTask } from "./bench";

const baseTask = {
  schemaVersion: 1,
  id: "hinge-unit",
  prompt: "做一个两件式铰链，销轴为 Z 轴过原点，直径间隙 0.35 到 0.45 mm。",
  parts: [
    { id: "fixed", selector: "fixed" },
    { id: "moving", selector: "moving" },
  ],
  joint: { type: "revolute", axisOrigin: [0, 0, 0], axisDirection: [0, 0, 1], borePartId: "moving", movingPartId: "moving" },
  requirements: [
    { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 2 } },
    { id: "diametral-clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "range", min: 0.35, max: 0.45, unit: "mm" } },
  ],
  motion: { rangeDeg: [-45, 45], steps: 9 },
  disassembly: { travelMm: 20, steps: 5 },
};

describe("alternate assembly benchmark", () => {
  test("accepts a well-formed task", () => {
    expect(validateTask(baseTask).id).toBe("hinge-unit");
  });

  test("rejects a requirement with no observer in this scorer", () => {
    // A silently unobservable requirement would either block forever or, worse,
    // be reported as met. Both are worse than refusing the task.
    const task = { ...baseTask, requirements: [...baseTask.requirements, { id: "physical-assembly", layer: "physical", required: true, applicable: true, expected: { kind: "equals", value: true } }] };
    expect(() => validateTask(task)).toThrow(/no observer/);
  });

  test("rejects a motion range that never samples the assembled pose", () => {
    expect(() => validateTask({ ...baseTask, motion: { rangeDeg: [10, 45], steps: 5 } })).toThrow(/straddle zero/);
  });

  test("rejects a bore part that is not one of the parts", () => {
    expect(() => validateTask({ ...baseTask, joint: { ...baseTask.joint, borePartId: "pin" } })).toThrow(/borePartId/);
  });

  test("rejects an unknown moving part", () => {
    expect(() => validateTask({ ...baseTask, joint: { ...baseTask.joint, movingPartId: "pin" } })).toThrow(/movingPartId/);
  });

  test("requires the motion form that matches the joint type", () => {
    const prismatic = { ...baseTask, joint: { ...baseTask.joint, type: "prismatic" } };
    // A prismatic joint has no angle to sweep; accepting rangeDeg here would
    // describe a motion the scorer never samples.
    expect(() => validateTask({ ...prismatic, motion: { rangeDeg: [-45, 45], steps: 5 } })).toThrow(/strokeMm/);
    expect(() => validateTask({ ...prismatic, motion: { strokeMm: [5, 30], steps: 5 } })).toThrow(/start at 0/);
    expect(validateTask({ ...prismatic, motion: { strokeMm: [0, 30], steps: 5 } }).motion.kind).toBe("prismatic");
  });

  test("never promotes a required NOT_RUN to a pass", () => {
    expect(aggregateStatus([{ status: "PASS", required: true }, { status: "NOT_RUN", required: true }])).toBe("NOT_RUN");
    expect(aggregateStatus([{ status: "PASS", required: true }, { status: "ERROR", required: true }])).toBe("ERROR");
    expect(aggregateStatus([{ status: "PASS", required: true }, { status: "NOT_RUN", required: false }])).toBe("PASS");
  });

  test("refuses a retention contract that also requires the part to slide off", () => {
    // A captured part cannot also be withdrawable; accepting this task would
    // ship an unsatisfiable case that every submission fails for the wrong reason.
    const task = {
      ...baseTask,
      retention: { pullMm: 2 },
      requirements: [...baseTask.requirements, { id: "disassembly-path", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } }],
    };
    expect(() => validateTask(task)).toThrow(/mutually exclusive/);
  });

  test("refuses a retention or source-motion requirement with nothing to measure it", () => {
    const retention = { ...baseTask, requirements: [...baseTask.requirements, { id: "axial-retention", layer: "physical", required: true, applicable: true, expected: { kind: "equals", value: true } }] };
    expect(() => validateTask(retention)).toThrow(/needs task.retention/);
    const source = { ...baseTask, requirements: [...baseTask.requirements, { id: "source-motion", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } }] };
    expect(() => validateTask(source)).toThrow(/needs task.pose/);
  });

  test("pose must match the joint unit and include the assembled pose", () => {
    const withPose = (pose: unknown) => ({ ...baseTask, pose });
    expect(() => validateTask(withPose({ parameter: "hinge_angle", unit: "mm", values: [-45, 0, 45] }))).toThrow(/match the joint type/);
    expect(() => validateTask(withPose({ parameter: "hinge_angle", unit: "deg", values: [10, 20, 30] }))).toThrow(/include 0/);
    expect(() => validateTask(withPose({ parameter: "agentscad_part", unit: "deg", values: [-45, 0, 45] }))).toThrow(/reserved/);
    expect(validateTask(withPose({ parameter: "hinge_angle", unit: "deg", values: [-45, 0, 45] })).pose?.parameter).toBe("hinge_angle");
  });

  test("states an expected outcome for every submission name", () => {
    expect(expectedOutcome("reference")).toBe("pass");
    expect(expectedOutcome("adversarial-floating")).toBe("fail");
    // A recorded model attempt is data, not an assertion about itself.
    expect(expectedOutcome("model-deepseek-v4-flash")).toBe("unscored");
    expect(() => expectedOutcome("random-name")).toThrow(/expected outcome/);
  });
});
