import { describe, expect, test } from "bun:test";

import {
  buildScadCodingPrompt,
  buildScadPrompt,
  isExperimentalMemoryPromptEnabled,
  skillInstructions,
} from "./skill-resolver";

describe("skill resolver containment", () => {
  test("keeps routing metadata out of the model instruction body", () => {
    expect(skillInstructions("---\nname: scad-coding\nversion: 1\n---\n# Instructions"))
      .toBe("# Instructions");
  });
  test("injects web research evidence into the generation prompt", async () => {
    const evidence = [
      "## External research (web evidence, verify before trusting)",
      "- body_height: 147.6 mm [https://en.wikipedia.org/wiki/IPhone_16] (unverified)",
    ].join("\n");

    const codeprompt = await buildScadCodingPrompt("box with real dimensions", "unknown", {}, null, evidence);
    expect(codeprompt?.userPrompt).toContain("<external_research>");
    expect(codeprompt?.userPrompt).toContain("147.6 mm");

    const prompt = await buildScadPrompt("box with real dimensions", "unknown", {}, evidence);
    expect(prompt?.userPrompt).toContain("## External research");
    expect(prompt?.userPrompt).toContain("147.6 mm");

    const withoutResearch = await buildScadPrompt("box with real dimensions", "unknown", {});
    expect(withoutResearch?.userPrompt).not.toContain("## External research");
  });

  test("experimental prompt memory is opt-in locally and always off in production", () => {
    expect(isExperimentalMemoryPromptEnabled({})).toBe(false);
    expect(isExperimentalMemoryPromptEnabled({ AGENTSCAD_MEMORY_PROMPT_ENABLED: "true" })).toBe(true);
    expect(isExperimentalMemoryPromptEnabled({
      NODE_ENV: "production",
      AGENTSCAD_MEMORY_PROMPT_ENABLED: "true",
    })).toBe(false);
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
    expect(prompt?.systemPrompt).toContain("# SCAD Planning");
    expect(prompt?.systemPrompt).not.toContain("when_not_to_use:");
  });
});
