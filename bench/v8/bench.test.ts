import { describe, expect, test } from "bun:test";
import { expectedV8Center, loadV8Tasks } from "./bench";
describe("V8 phase carrier task", () => {
  test("freezes 18 selectors and four phase groups", async () => {
    const tasks = await loadV8Tasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.selectors.rods).toHaveLength(8);
    expect(task.selectors.sliders).toHaveLength(8);
    expect(task.contract.phasesDeg).toEqual([0, 90, 180, 270]);
    expect(new Set([task.selectors.frame, task.selectors.crank, ...task.selectors.rods, ...task.selectors.sliders]).size).toBe(18);
  });
  test("places both banks from the same phase group", async () => {
    const task = (await loadV8Tasks())[0];
    const left = expectedV8Center(task.contract, 0, 0, 0);
    const right = expectedV8Center(task.contract, 0, 1, 0);
    expect(left[1]).toBe(-33);
    expect(right[1]).toBe(-27);
    expect(left[0]).toBeCloseTo(-right[0], 12);
    expect(left[2]).toBeCloseTo(right[2], 12);
  });
});
