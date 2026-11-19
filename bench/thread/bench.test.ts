import { describe, expect, test } from "bun:test";
import { loadThreadTasks } from "./bench";
describe("thread task", () => {
  test("freezes two parts, pitch and turn plan", async () => {
    const tasks = await loadThreadTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.selectors.bolt).toBe("bolt");
    expect(task.selectors.nut).toBe("nut");
    expect(task.geometry.external.pitchMm).toBe(1.5);
    expect(task.turns.length).toBe(9);
    expect(task.requirements.find((r) => r.id === "distinct-exported-parts")?.expected.kind).toBe("equals");
  });
});
