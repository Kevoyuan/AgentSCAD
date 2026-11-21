import { describe, expect, test } from "bun:test";
import { loadProductTasks, validateProductTask } from "./bench";
describe("product-path tasks", () => {
  test("freezes the six-part guided product task and its seven layers", async () => {
    const tasks = await loadProductTasks();
    const task = tasks.find((entry) => entry.id === "guided-product-8-28");
    expect(task).toBeDefined();
    expect(task!.partCount).toBe(6);
    expect(task!.requirements.map((r) => r.id)).toEqual(["distinct-exported-parts", "part-connectivity", "assembly-reconstruction", "assembly-path", "disassembly-path", "diametral-clearance", "measured-joint-frames"]);
    expect(task!.fit?.minClearanceMm).toBe(0.1);
    expect(task!.request).toBeUndefined();
  });
  test("freezes the contract-driven slider-crank product task with motion layers", async () => {
    const tasks = await loadProductTasks();
    const task = tasks.find((entry) => entry.id === "product-slider-crank-360");
    expect(task).toBeDefined();
    expect(task!.partCount).toBe(4);
    expect(task!.request).toContain("single-cylinder slider-crank");
    expect(task!.fit).toBeUndefined();
    expect(task!.requirements.map((r) => r.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "assembly-reconstruction",
      "diametral-clearance", "measured-joint-frames", "rigid-motion", "source-motion",
    ]);
  });
  test("freezes the retained-key disassembly product task", async () => {
    const tasks = await loadProductTasks();
    const task = tasks.find((entry) => entry.id === "product-keyed-slider-crank-disassembly");
    expect(task).toBeDefined();
    expect(task!.partCount).toBe(5);
    expect(task!.request).toContain("eccentric retention key");
    expect(task!.fit).toBeUndefined();
    expect(task!.requirements.map((r) => r.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "assembly-reconstruction",
      "assembly-path", "disassembly-path",
    ]);
  });
  test("refuses a requirement id the product path cannot observe", () => {
    expect(() => validateProductTask({
      schemaVersion: 1, id: "bad-task", prompt: "a task with an unobservable requirement", partCount: 1,
      requirements: [{ id: "rigid-motion-not-real", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } }],
    })).toThrow("no product observer");
  });
});
