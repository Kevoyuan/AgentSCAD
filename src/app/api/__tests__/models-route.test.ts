import { describe, expect, test } from "bun:test";

import {
  buildModelCatalog,
  isModelMultimodal,
} from "@/app/api/models/route";
import type {
  ProviderConfig,
  PublicProviderConfig,
} from "@/lib/provider-settings";

const timestamp = "2026-07-16T00:00:00.000Z";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "configured-openai",
    name: "Configured OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6",
    enabled: true,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function envProvider(overrides: Partial<PublicProviderConfig> = {}): PublicProviderConfig {
  return {
    ...provider({
      id: "env-google",
      name: "Google Gemini",
      type: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-3.5-flash",
      isDefault: false,
    }),
    hasApiKey: true,
    ...overrides,
  };
}

describe("model catalog route helpers", () => {
  test("maps configured recommendations and conservative unknown models", () => {
    const models = buildModelCatalog({
      providers: [
        provider(),
        provider({
          id: "custom",
          name: "Private model",
          defaultModel: "private-text-model",
          isDefault: false,
        }),
        provider({ id: "disabled", enabled: false }),
      ],
      envProviders: [],
      includeBuiltIns: false,
    });

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: "provider:configured-openai:gpt-5.6",
      name: "GPT-5.6 Sol",
      multimodal: true,
      category: "flagship",
    });
    expect(models[1]).toMatchObject({
      id: "provider:custom:private-text-model",
      name: "private-text-model",
      multimodal: false,
      category: "code",
    });
  });

  test("expands enabled environment providers into qualified recommendations", () => {
    const models = buildModelCatalog({
      providers: [],
      envProviders: [
        envProvider(),
        envProvider({ id: "env-openai", enabled: false }),
        envProvider({ id: "env-unknown", name: "Unknown" }),
      ],
      includeBuiltIns: false,
    });

    expect(models.map((model) => model.id)).toEqual([
      "provider:env-google:gemini-3.5-flash",
      "provider:env-google:gemini-3.1-pro-preview",
      "provider:env-google:gemini-3.1-flash-lite",
    ]);
  });

  test("includes built-ins only when requested and removes duplicate IDs", () => {
    const withoutBuiltIns = buildModelCatalog({
      providers: [],
      envProviders: [],
      includeBuiltIns: false,
    });
    const withBuiltIns = buildModelCatalog({
      providers: [],
      envProviders: [],
      includeBuiltIns: true,
    });

    expect(withoutBuiltIns).toEqual([]);
    expect(withBuiltIns.some((model) => model.id === "gpt-5.6")).toBe(true);
    expect(new Set(withBuiltIns.map((model) => model.id)).size).toBe(withBuiltIns.length);
  });

  test("detects vision support for raw and provider-qualified IDs", () => {
    expect(isModelMultimodal(null)).toBe(false);
    expect(isModelMultimodal("unknown-model")).toBe(false);
    expect(isModelMultimodal("gpt-5.6")).toBe(true);
    expect(isModelMultimodal("provider:env-google:gemini-3.5-flash")).toBe(true);
    expect(isModelMultimodal("provider:env-deepseek:deepseek-v4-pro")).toBe(false);
  });
});
