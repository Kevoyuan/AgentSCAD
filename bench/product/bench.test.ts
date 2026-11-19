import { describe, expect, test } from "bun:test";
import { loadProductTasks } from "./bench";
describe("product-path task", () => {
  test("freezes six parts and six product layers", async () => {
    const tasks = await loadProductTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.partCount).toBe(6);
    expect(task.requirements.map((r) => r.id)).toEqual(["distinct-exported-parts", "part-connectivity", "assembly-reconstruction", "assembly-path", "disassembly-path", "diametral-clearance"]);
    expect(task.fit?.minClearanceMm).toBe(0.1);
  });
});
