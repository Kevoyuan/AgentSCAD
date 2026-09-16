import { describe, expect, test } from "bun:test";

import {
  PROMPT_SECTION_CHAR_BUDGETS,
  boundPromptSection,
  buildScadCodingPrompt,
  buildScadPrompt,
  isExperimentalMemoryPromptEnabled,
} from "./skill-resolver";

describe("skill resolver containment", () => {
  test("experimental prompt memory is opt-in locally and always off in production", () => {
    expect(isExperimentalMemoryPromptEnabled({})).toBe(false);
    expect(isExperimentalMemoryPromptEnabled({ AGENTSCAD_MEMORY_PROMPT_ENABLED: "true" })).toBe(true);
    expect(isExperimentalMemoryPromptEnabled({
      NODE_ENV: "production",
      AGENTSCAD_MEMORY_PROMPT_ENABLED: "true",
    })).toBe(false);
  });

  test("bounds prompt sections and makes truncation visible", () => {
    const bounded = boundPromptSection("x".repeat(100), 20, "test section");
    expect(bounded.startsWith("x".repeat(20))).toBe(true);
    expect(bounded).toContain("test section truncated: 80 characters omitted");
    expect(PROMPT_SECTION_CHAR_BUDGETS.retrieval).toBeLessThanOrEqual(16_000);
  });

  test("unknown requests receive no arbitrary CAD example or printable pattern", async () => {
    const previous = process.env.AGENTSCAD_MEMORY_PROMPT_ENABLED;
    delete process.env.AGENTSCAD_MEMORY_PROMPT_ENABLED;
    try {
      const prompt = await buildScadPrompt("行星发动机模型", "unknown", {});
      expect(prompt).not.toBeNull();
      expect(prompt?.systemPrompt).not.toContain("### electronics_enclosure");
      expect(prompt?.systemPrompt).not.toContain("### pipe_clamp");
      expect(prompt?.systemPrompt).not.toContain("### printable_rules");
      expect(prompt?.userPrompt).not.toContain("Learned patterns from user edits");
    } finally {
      if (previous === undefined) delete process.env.AGENTSCAD_MEMORY_PROMPT_ENABLED;
      else process.env.AGENTSCAD_MEMORY_PROMPT_ENABLED = previous;
    }
  });

  test("planned coding uses a focused prompt and requests only SCAD output", async () => {
    const prompt = await buildScadCodingPrompt(
      "phone case with camera opening",
      "phone_case",
      { wall_thickness: 2 },
      { modeling_plan: ["create shell", "subtract camera opening"] },
    );
    expect(prompt).not.toBeNull();
    expect(prompt?.userPrompt).toContain("<generation_plan>");
    expect(prompt?.userPrompt).toContain("Return only one ```scad fenced block");
    expect(prompt?.systemPrompt).not.toContain("Part 1 — CAD Intent JSON");
  });
});
