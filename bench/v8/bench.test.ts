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
    expect(tasks.map((task) => task.id)).toEqual(["v8-block-bearings-8", "v8-bored-8", "v8-phase-8"]);
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
    expect(task.counterweight).toEqual({ webOffsetMm: 8, minOppositeRadiusMm: 12, maxPinSideRadiusMm: 11, angleToleranceDeg: 35 });
    expect(task.guide).toEqual({ offsetMm: 10.1, toleranceMm: 0.15, minGapMm: 0.2, maxGapMm: 1.0 });
    expect(task.requirements.map((entry) => entry.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "frame-connectivity", "bearing-fit",
      "measured-joint-frames", "sampled-motion", "source-motion", "counterweight-balance",
      "guide-clearance",
    ]);
  });

  test("freezes the independent-throw closed-bore rung", async () => {
    const task = await taskById("v8-bored-8");
    expect(task.prompt).toContain("closed cylinder bores");
    expect(task.contract.instances).toHaveLength(8);
    expect(task.contract.instances?.map((entry) => entry.yMm)).toEqual([-91, -65, -39, -13, 13, 39, 65, 91]);
    expect(task.contract.instances?.map((entry) => entry.phaseDeg)).toEqual([0, 90, 180, 270, 45, 135, 225, 315]);
    expect(task.boreClearance).toEqual({ innerRadiusMm: 10.1, radiusToleranceMm: 0.1, minGapMm: 0.15, maxGapMm: 0.6 });
    expect(task.headClearance).toEqual({ minGapMm: 1.5, maxGapMm: 6.0 });
    expect(task.bearingFit).toEqual({ stationsY: [-98, 98], minClearanceMm: 0.2, maxClearanceMm: 0.6, maxAxisOffsetMm: 0.3 });
    expect(task.requirements.map((entry) => entry.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "frame-connectivity", "bearing-fit",
      "bore-clearance", "head-clearance", "measured-joint-frames", "sampled-motion", "source-motion",
    ]);
  });

  test("a bore-clearance requirement without a declared bore contract is rejected", () => {
    expect(() => validateV8Task({
      schemaVersion: 1, id: "v8-bad-bore", prompt: "a V8 task with a bore requirement",
      selectors: {
        frame: "frame", crank: "crank",
        rods: ["rod0", "rod1", "rod2", "rod3", "rod4", "rod5", "rod6", "rod7"],
        sliders: ["slider0", "slider1", "slider2", "slider3", "slider4", "slider5", "slider6", "slider7"],
      },
      motionParameter: "crank_angle", angles: [0, 90, 180],
      contract: { crankRadiusMm: 8, rodLengthMm: 28, vHalfAngleDeg: 45, bankYmm: 3, stationsY: [-30, -10, 10, 30], phasesDeg: [0, 90, 180, 270], sliderToleranceMm: 0.1 },
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 18 } },
        { id: "bore-clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    })).toThrow("needs a boreClearance contract");
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

  test("a counterweight requirement without a declared sector contract is rejected", () => {
    expect(() => validateV8Task({
      schemaVersion: 1, id: "v8-bad-balance", prompt: "a V8 task with a counterweight requirement",
      selectors: {
        frame: "frame", crank: "crank",
        rods: ["rod0L", "rod0R", "rod1L", "rod1R", "rod2L", "rod2R", "rod3L", "rod3R"],
        sliders: ["slider0L", "slider0R", "slider1L", "slider1R", "slider2L", "slider2R", "slider3L", "slider3R"],
      },
      motionParameter: "crank_angle", angles: [0, 90, 180],
      contract: { crankRadiusMm: 8, rodLengthMm: 28, vHalfAngleDeg: 45, bankYmm: 3, stationsY: [-30, -10, 10, 30], phasesDeg: [0, 90, 180, 270], sliderToleranceMm: 0.1 },
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 18 } },
        { id: "counterweight-balance", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    })).toThrow("needs a counterweight contract");
  });

  test("a guide-clearance requirement without a declared guide contract is rejected", () => {
    expect(() => validateV8Task({
      schemaVersion: 1, id: "v8-bad-guide", prompt: "a V8 task with a guide requirement",
      selectors: {
        frame: "frame", crank: "crank",
        rods: ["rod0L", "rod0R", "rod1L", "rod1R", "rod2L", "rod2R", "rod3L", "rod3R"],
        sliders: ["slider0L", "slider0R", "slider1L", "slider1R", "slider2L", "slider2R", "slider3L", "slider3R"],
      },
      motionParameter: "crank_angle", angles: [0, 90, 180],
      contract: { crankRadiusMm: 8, rodLengthMm: 28, vHalfAngleDeg: 45, bankYmm: 3, stationsY: [-30, -10, 10, 30], phasesDeg: [0, 90, 180, 270], sliderToleranceMm: 0.1 },
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 18 } },
        { id: "guide-clearance", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    })).toThrow("needs a guide contract");
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
