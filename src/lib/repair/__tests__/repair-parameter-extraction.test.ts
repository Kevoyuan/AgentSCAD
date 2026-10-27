import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Bun module replacements survive mock.restore(); keep this mock isolated.
if (process.env.AGENTSCAD_REPAIR_PARAM_TEST_CHILD === "1") {
  registerRepairParameterTests();
} else {
  test("repair parameter extraction runs with isolated module mocks", () => {
    const result = spawnSync(process.execPath, ["test", "--timeout", "30000", import.meta.path], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, AGENTSCAD_REPAIR_PARAM_TEST_CHILD: "1" },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 60_000);
}

function registerRepairParameterTests() {
  const scad = [
    "// repaired V8",
    "total_length = 842;",
    "bore = 100;",
    "module generated_part() {",
    "  cube([total_length, bore, bore]);",
    "}",
    "generated_part();",
  ].join("\n");

  mock.module("@/lib/tools/model-router", () => ({
    createChatCompletionDetailed: mock(async () => ({
      content: scad,
      model: "deepseek-v4-flash",
      provider: "DeepSeek",
      finishReason: "stop",
      responseLength: scad.length,
      rawSnippet: "module generated_part() { ... }",
    })),
  }));

  test("re-extracts repaired SCAD parameters so callers do not persist the stale schema", async () => {
    const { runRepair } = await import("@/lib/repair/repair-controller");
    const result = await runRepair({
      originalRequest: "V8 engine",
      partFamily: "unknown",
      currentScadCode: "cube(1);",
      validationResults: [],
    });

    expect(result.generationResult.scad_source).toContain("total_length");
    expect(result.generationResult.parameters.map((parameter) => parameter.key)).toEqual([
      "total_length",
      "bore",
    ]);
  });
}
