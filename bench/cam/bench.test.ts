import { describe, expect, test } from "bun:test";
import { loadCamTasks } from "./bench";
describe("cam task", () => {
  test("freezes eccentricity, lift angles and three selectors", async () => {
    const tasks = await loadCamTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.eccentricityMm).toBe(4);
    expect(task.camRadiusMm).toBe(10);
    expect(task.angles).toEqual([0, 90, 180, 270, 360]);
    expect(task.requirements.map((r) => r.id)).toEqual(["distinct-exported-parts", "rigid-motion", "contact-gap"]);
    expect(task.contactGap).toEqual({ minMm: 0.18, maxMm: 0.22 });
  });
});
