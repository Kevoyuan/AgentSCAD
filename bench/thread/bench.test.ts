import { describe, expect, test } from "bun:test";
import { loadThreadTasks } from "./bench";
describe("thread task", () => {
  test("freezes two parts, pitch and turn plan", async () => {
    const tasks = await loadThreadTasks();
    expect(tasks).toHaveLength(2);
    const task = tasks.find((entry) => entry.id === "threaded-fastener-1-5")!;
    expect(task.selectors.bolt).toBe("bolt");
    expect(task.selectors.nut).toBe("nut");
    expect(task.geometry.external.pitchMm).toBe(1.5);
    expect(task.turns.length).toBe(9);
    expect(task.exit).toBeUndefined();
    const exitTask = tasks.find((entry) => entry.id === "threaded-fastener-exit-1-5")!;
    expect(exitTask.turns.length).toBe(49);
    expect(exitTask.exit?.minTurns).toBe(12);
    expect(exitTask.requirements.some((r) => r.id === "disassembly-path")).toBe(true);
  });
});
