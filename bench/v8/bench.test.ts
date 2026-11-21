import { describe, expect, test } from "bun:test";
import { expectedV8Center, loadV8Tasks, validateV8Task } from "./bench";

const taskById = async (id: string) => {
  const tasks = await loadV8Tasks();
  const task = tasks.find((entry) => entry.id === id);
  if (!task) throw new Error(`missing task ${id}`);
  return task;
};

describe("V8 bench tasks", () => {
  test("freezes the phase carrier and its connected-crank contract", async () => {
    const tasks = await loadV8Tasks();
    expect(tasks.map((task) => task.id)).toEqual(["v8-block-bearings-8", "v8-phase-8"]);
    const task = await taskById("v8-phase-8");
    expect(task.selectors.rods).toHaveLength(8);
    expect(task.selectors.sliders).toHaveLength(8);
    expect(task.contract.phasesDeg).toEqual([0, 90, 180, 270]);
    expect(new Set([task.selectors.frame, task.selectors.crank, ...task.selectors.rods, ...task.selectors.sliders]).size).toBe(18);
    expect(task.prompt).toContain("connected crankshaft");
    expect(task.requirements.find((entry) => entry.id === "part-connectivity")).toMatchObject({ layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } });
  });

  test("freezes the crankcase block/bearing rung with measured fit bounds", async () => {
    const task = await taskById("v8-block-bearings-8");
    expect(task.prompt).toContain("crankcase block");
    expect(task.bearingFit).toEqual({ stationsY: [-20, 20], minClearanceMm: 0.4, maxClearanceMm: 1.6, maxAxisOffsetMm: 0.3 });
    expect(task.requirements.map((entry) => entry.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "frame-connectivity", "bearing-fit",
      "measured-joint-frames", "sampled-motion", "source-motion",
    ]);
  });

  test("a bearing-fit requirement without a declared fit contract is rejected", () => {
    const base = {
      schemaVersion: 1, id: "v8-bad", prompt: "a V8 task with a bearing requirement", selectors: {
        frame: "frame", crank: "crank",
        rods: ["rod0L", "rod0R", "rod1L", "rod1R", "rod2L", "rod2R", "rod3L", "rod3R"],
        sliders: ["slider0L", "slider0R", "slider1L", "slider1R", "slider2L", "slider2R", "slider3L", "slider3R"],
      },
      motionParameter: "crank_angle", angles: [0, 90, 180],
      contract: { crankRadiusMm: 8, rodLengthMm: 28, vHalfAngleDeg: 45, bankYmm: 3, stationsY: [-30, -10, 10, 30], phasesDeg: [0, 90, 180, 270], sliderToleranceMm: 0.1 },
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 18 } },
        { id: "bearing-fit", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    };
    expect(() => validateV8Task(base)).toThrow("needs a bearingFit contract");
  });

  test("places both banks from the same phase group", async () => {
    const task = await taskById("v8-phase-8");
    const left = expectedV8Center(task.contract, 0, 0, 0);
    const right = expectedV8Center(task.contract, 0, 1, 0);
    expect(left[1]).toBe(-33);
    expect(right[1]).toBe(-27);
    expect(left[0]).toBeCloseTo(-right[0], 12);
    expect(left[2]).toBeCloseTo(right[2], 12);
  });
});
