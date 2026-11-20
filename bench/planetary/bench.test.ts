import { describe, expect, test } from "bun:test";
import { loadPlanetaryTasks } from "./bench";
describe("planetary task", () => {
  test("freezes sun/planet/ring teeth and positive/negative poses", async () => {
    const tasks = await loadPlanetaryTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect([task.sunTeeth, task.planetTeeth, task.ringTeeth]).toEqual([12, 12, 36]);
    expect(task.ringTeeth).toBe(task.sunTeeth + 2 * task.planetTeeth);
    expect(task.poses.some((p) => p > 0)).toBe(true);
    expect(task.poses.some((p) => p < 0)).toBe(true);
    const distinct = task.requirements.find((r) => r.id === "distinct-exported-parts");
    expect(distinct?.expected.kind === "equals" ? distinct.expected.value : null).toBe(4);
  });
});
