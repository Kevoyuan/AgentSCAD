import { describe, expect, test } from "bun:test";

import {
  getProviderPreset,
  getProviderPresetByModel,
  getRecommendedProviderModel,
  PROVIDER_PRESETS,
} from "@/lib/provider-catalog";
import { getEnvProviderConfigs } from "@/lib/provider-settings";

describe("provider catalog", () => {
  test("uses unique provider and per-provider model IDs", () => {
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length);

    for (const preset of PROVIDER_PRESETS) {
      const modelIds = preset.recommendedModels.map((model) => model.id);
      expect(new Set(modelIds).size).toBe(modelIds.length);
    }
  });

  test("keeps each hosted provider default in its recommendation list", () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.recommendedModels.length === 0) continue;
      expect(preset.recommendedModels[0]?.id).toBe(preset.defaultModel);
    }
  });

  test("contains the July 2026 provider defaults", () => {
    expect(getProviderPreset("openai")?.defaultModel).toBe("gpt-5.6");
    expect(getProviderPreset("anthropic")?.defaultModel).toBe("claude-fable-5");
    expect(getProviderPreset("google")?.defaultModel).toBe("gemini-3.5-flash");
    expect(getProviderPreset("deepseek")?.defaultModel).toBe("deepseek-v4-pro");
    expect(getProviderPreset("zhipu")?.defaultModel).toBe("glm-5.2");
    expect(getProviderPreset("minimax-global")?.defaultModel).toBe("MiniMax-M3");
    expect(getProviderPreset("bailian")?.defaultModel).toBe("qwen3.7-max-2026-06-08");
    expect(getRecommendedProviderModel("qwen3.7-max-2026-06-08")?.model.multimodal).toBe(true);
    expect(getRecommendedProviderModel("qwen/qwen3.6-27b")?.model.multimodal).toBe(true);
  });

  test("resolves non-default recommendations to their provider metadata", () => {
    expect(getProviderPresetByModel("gpt-5.6-terra")?.id).toBe("openai");
    expect(getRecommendedProviderModel("gemini-3.1-pro-preview")?.model.multimodal).toBe(true);
  });

  test("does not advertise local servers as active environment providers", () => {
    const environmentProviderIds = getEnvProviderConfigs().map((provider) => provider.id);
    expect(environmentProviderIds).not.toContain("env-ollama");
    expect(environmentProviderIds).not.toContain("env-lmstudio");
    expect(environmentProviderIds).not.toContain("env-litellm");
    expect(environmentProviderIds).not.toContain("env-vllm");
  });

  test("enables hosted environment providers only when their key is present", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(getEnvProviderConfigs().find((provider) => provider.id === "env-openai")?.enabled).toBe(false);

    process.env.OPENAI_API_KEY = "test-key";
    expect(getEnvProviderConfigs().find((provider) => provider.id === "env-openai")?.enabled).toBe(true);

    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
});
