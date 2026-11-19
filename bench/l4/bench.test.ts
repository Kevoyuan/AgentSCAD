import { describe, expect, test } from "bun:test";
import { loadL4Tasks } from "./bench";

describe("L4 declaration-bound task", () => {
  test("freezes seven parts, nine instances and a wrong-order operation pair", async () => {
    const tasks = await loadL4Tasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.id).toBe("slider-shaft-keyed-7x9");
    expect(task.spec.parts).toHaveLength(7);
    expect(task.spec.instances).toHaveLength(9);
    expect(task.spec.operations).toHaveLength(8);
    const operationIds = new Set(task.spec.operations.map((operation) => operation.id));
    expect(operationIds.has(task.wrongOrder.operationId)).toBe(true);
    expect(operationIds.has(task.wrongOrder.beforeOperationId)).toBe(true);
    const distinct = task.requirements.find((requirement) => requirement.id === "distinct-exported-parts");
    expect(distinct?.expected.kind).toBe("equals");
    expect(distinct?.expected.kind === "equals" ? distinct.expected.value : null).toBe(9);
    expect(task.motion.angles).toContain(0);
  });
});
