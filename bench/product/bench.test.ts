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
    expect(task!.fit?.minClearanceMm).toBe(0.1);
    expect(task!.fit?.requirements.map((r) => r.connectionId)).toEqual(["main_shaft", "eccentric", "wrist"]);
    expect(task!.requirements.map((r) => r.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "assembly-reconstruction",
      "diametral-clearance", "measured-joint-frames", "assembly-path", "disassembly-path",
    ]);
  });
  test("freezes the nine-pose slider-crank source task", async () => {
    const tasks = await loadProductTasks();
    const task = tasks.find((entry) => entry.id === "product-slider-crank-nine-pose");
    expect(task).toBeDefined();
    expect(task!.partCount).toBe(4);
    expect(task!.sourcePoses?.count).toBe(9);
    expect(task!.sourcePoses?.anglesDeg).toEqual([0, 40, 80, 120, 160, 200, 240, 280, 320]);
    expect(task!.sourcePoses?.budgetMs).toBe(300000);
    expect(task!.requirements.map((r) => r.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "assembly-reconstruction", "rigid-motion", "source-motion-nine",
    ]);
  });

  test("a source-motion-nine requirement without a sourcePoses contract is rejected", () => {
    expect(() => validateProductTask({
      schemaVersion: 1, id: "bad-nine", prompt: "a task with a nine-pose requirement", partCount: 1,
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 1 } },
        { id: "source-motion-nine", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    })).toThrow("needs a sourcePoses contract");
  });

  test("freezes the sampled tool-access task", async () => {
    const tasks = await loadProductTasks();
    const task = tasks.find((entry) => entry.id === "product-guided-tool-access");
    expect(task).toBeDefined();
    expect(task!.partCount).toBe(6);
    expect(task!.toolAccess?.toolRadiusMm).toBe(0.5);
    expect(task!.toolAccess?.approaches).toEqual([{ id: "guide_top", instanceId: "guide_front", direction: [0, 0, 1] }]);
    expect(task!.requirements.map((r) => r.id)).toEqual([
      "distinct-exported-parts", "part-connectivity", "assembly-reconstruction", "tool-access",
    ]);
  });

  test("a tool-access requirement without a toolAccess contract is rejected", () => {
    expect(() => validateProductTask({
      schemaVersion: 1, id: "bad-tool", prompt: "a task with a tool requirement", partCount: 1,
      requirements: [
        { id: "distinct-exported-parts", layer: "parts", required: true, applicable: true, expected: { kind: "equals", value: 1 } },
        { id: "tool-access", layer: "assembly", required: true, applicable: true, expected: { kind: "equals", value: true } },
      ],
    })).toThrow("needs a toolAccess contract");
  });

  test("refuses a requirement id the product path cannot observe", () => {
    expect(() => validateProductTask({
      schemaVersion: 1, id: "bad-task", prompt: "a task with an unobservable requirement", partCount: 1,
      requirements: [{ id: "rigid-motion-not-real", layer: "motion", required: true, applicable: true, expected: { kind: "equals", value: true } }],
    })).toThrow("no product observer");
  });
});
