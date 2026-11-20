import { describe, expect, test } from "bun:test";
import { expectedVTwinCenter, loadVTwinTasks } from "./bench";

describe("V-twin task", () => {
  test("freezes six selectors, nine angles and a 90-degree V", async () => {
    const tasks = await loadVTwinTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.id).toBe("v-twin-8-28");
    expect(Object.keys(task.selectors)).toHaveLength(6);
    expect(task.angles).toHaveLength(9);
    expect(task.contract.vHalfAngleDeg).toBe(45);
    expect(task.contract.bankYmm).toBe(10);
  });

  test("shared-pin closure places both banks at the same crank angle", async () => {
    const task = (await loadVTwinTasks())[0];
    const left = expectedVTwinCenter(task.contract, 0, "left");
    const right = expectedVTwinCenter(task.contract, 0, "right");
    expect(left[1]).toBe(-10);
    expect(right[1]).toBe(10);
    expect(left[2]).toBeCloseTo(right[2], 12);
    expect(left[0]).toBeCloseTo(-right[0], 12);
  });
});
