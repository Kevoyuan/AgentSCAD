import { describe, expect, test } from "bun:test";
import { loadPlanetary3Tasks } from "./bench";
describe("three-planet task", () => {
  test("freezes three planets, offsets and six selectors", async () => {
    const tasks = await loadPlanetary3Tasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.selectors.planets).toHaveLength(3);
    expect(task.planetOffsetsDeg).toEqual([0, 120, 240]);
    expect(task.ringTeeth).toBe(task.sunTeeth + 2 * task.planetTeeth);
    expect(task.requirements.find((r) => r.id === "distinct-exported-parts")?.expected.kind).toBe("equals");
  });
});
