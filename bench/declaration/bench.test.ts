import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateAssemblySpec } from "../../src/lib/assembly/assembly-spec";
import { checkDeclarationContract, loadDeclarationTasks } from "./bench";

describe("declaration contract", () => {
  test("loads the six-role guided task", async () => {
    const tasks = await loadDeclarationTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.contract.parts).toHaveLength(6);
    expect(task.contract.operations).toEqual(["guide_front", "eccentric_key", "slider", "rod", "crank"]);
    expect(task.contract.wrongOrder).not.toEqual(task.contract.operations);
  });

  test("accepts the renamed reference declaration", async () => {
    const task = (await loadDeclarationTasks())[0];
    const source = await readFile("bench/declaration/submissions/guided-declaration-8-28/reference.scad", "utf8");
    const match = source.match(/AGENTSCAD_ASSEMBLY_V1\s*(\{[\s\S]*?\})\s*END_AGENTSCAD_ASSEMBLY/);
    expect(match).not.toBeNull();
    const spec = validateAssemblySpec(JSON.parse(match![1]));
    expect(spec.success).toBe(true);
    if (!spec.success) return;
    expect(checkDeclarationContract(spec.data, task.contract).status).toBe("PASS");
  });
});
