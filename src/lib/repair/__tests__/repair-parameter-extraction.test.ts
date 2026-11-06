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
  const systemPrompts: string[] = [];
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
    createChatCompletionDetailed: mock(async (request: { messages: Array<{ role: string; content: string }> }) => {
      systemPrompts.push(request.messages.find(message => message.role === "system")?.content ?? "");
      return {
        content: scad,
        model: "deepseek-v4-flash",
        provider: "DeepSeek",
        finishReason: "stop",
        responseLength: scad.length,
        rawSnippet: "module generated_part() { ... }",
      };
    }),
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

  test("a missing assembly declaration gets the contract and bore role in the real repair prompt", async () => {
    const { runRepair } = await import("@/lib/repair/repair-controller");
    await runRepair({
      originalRequest: "A removable two-part hinge", partFamily: "unknown",
      currentScadCode: "cube(1);",
      validationResults: [{ rule_id: "A001", rule_name: "Assembly contract evidence", level: "ENGINEERING",
        status: "FAIL", passed: false, is_critical: true, message: "Missing assembly declaration" }],
    });
    const prompt = systemPrompts.at(-1)!;
    expect(prompt).toContain("AGENTSCAD_ASSEMBLY_V1");
    expect(prompt).toContain("boreInstanceId");
    expect(prompt).toContain("agentscad_part");
    expect(prompt).toContain("Part 1 — CAD Intent JSON");
    expect(prompt).not.toContain("Return only one ```scad fenced block");
  });

  test("ordinary single-part repair does not receive the assembly schema", async () => {
    const { runRepair } = await import("@/lib/repair/repair-controller");
    await runRepair({ originalRequest: "A simple cube", partFamily: "unknown", currentScadCode: "cube(1);", validationResults: [] });
    expect(systemPrompts.at(-1)).not.toContain("AGENTSCAD_ASSEMBLY_V1");
  });

  test("a compile failure on an explicit assembly also receives the schema", async () => {
    const { runRepair } = await import("@/lib/repair/repair-controller");
    await runRepair({ originalRequest: "两件式铰链，可组装可拆卸", partFamily: "unknown", currentScadCode: "cube(1);", validationResults: [] });
    expect(systemPrompts.at(-1)).toContain("boreInstanceId");
  });

  test("an isolated completion adapter receives the real repair prompt once", async () => {
    const { runRepair } = await import("@/lib/repair/repair-controller");
    const requests: Array<{messages: Array<{role: string; content: unknown}>}> = [];
    const result = await runRepair({
      originalRequest: "两件式铰链，可组装可拆卸", partFamily: "unknown",
      currentScadCode: "cube(1);", validationResults: [],
    }, { complete: async request => {
      requests.push(request);
      return { content: scad, model: "test", provider: "test", finishReason: "stop", responseLength: scad.length, rawSnippet: "" };
    } });
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain("boreInstanceId");
    expect(result.generationResult.scad_source).toContain("total_length");
  });
}
