import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { ModelRequestError } from "@/lib/model-runtime";

// Bun module replacements survive mock.restore(), so keep the mocked runner in a
// child process and let every other suite import the real modules.
if (process.env.AGENTSCAD_SKILL_STREAM_TEST_CHILD === "1") {
  registerStreamingSkillTests();
} else {
  test("skill-runner streaming wiring runs with isolated module mocks", () => {
    const result = spawnSync(process.execPath, ["test", "--timeout", "30000", import.meta.path], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        AGENTSCAD_SKILL_STREAM_TEST_CHILD: "1",
        AGENTSCAD_WEB_RESEARCH: "off",
      },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 60_000);
}

function registerStreamingSkillTests() {
  const requests: Array<{ stream?: boolean }> = [];
  const diagnostics: string[] = [];
  let attempts = 0;

  mock.module("@/lib/tools/model-router", () => ({
    createChatCompletionDetailed: mock(async (request: { stream?: boolean }) => {
      requests.push(request);
      attempts += 1;
      if (attempts === 1) {
        throw new ModelRequestError(
          "LLM_UNAVAILABLE",
          "connection interrupted (ECONNRESET)",
          true,
          { evidence: { transportCode: "ECONNRESET" } },
        );
      }
      const scad = [
        "include <agentscad_std.scad>;",
        "width = 20;",
        "module generated_part() {",
        "  cube([width, width, width]);",
        "}",
        "generated_part();",
      ].join("\n");
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

  mock.module("@/lib/tools/scad-renderer", () => ({
    validateGeneratedScadSource: mock(async () => undefined),
  }));

  test("generation requests a stream and retries one dropped connection", async () => {
    const { runScadGenerationSkill } = await import("@/lib/harness/skill-runner");

    const result = await runScadGenerationSkill(
      "a 20 mm cube",
      {},
      "provider:test:deepseek-v4-flash",
      "unknown",
      undefined,
      undefined,
      undefined,
      undefined,
      (message) => diagnostics.push(message),
    );

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.stream === true)).toBe(true);
    expect(diagnostics.some((message) => message.includes("ECONNRESET"))).toBe(true);
    expect(result.scad_source).toContain("generated_part");
  }, 20_000);
}
