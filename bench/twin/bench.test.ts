import { describe, expect, test } from "bun:test";
import { loadTwinTasks } from "./bench";

describe("inline twin task", () => {
  test("freezes six selectors, five angles and the 180-degree phase", async () => {
    const tasks = await loadTwinTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.id).toBe("twin-inline-8-28");
    expect(Object.keys(task.selectors)).toHaveLength(6);
    expect(task.angles).toEqual([0, 90, 180, 270, 360]);
    expect(task.contract.phaseDeg).toBe(180);
    expect(task.contract.rightYmm - task.contract.leftYmm).toBe(50);
    expect(task.requirements.find((requirement) => requirement.id === "distinct-exported-parts")?.expected.kind).toBe("equals");
  });
});
