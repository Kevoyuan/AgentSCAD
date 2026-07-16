import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PROVIDER_PERSISTENCE,
  getProviderEnvironmentKey,
  getProviderSettingsUiState,
} from "@/components/cad/provider-settings-state";

describe("provider settings UI state", () => {
  test("starts safe while persistence capabilities are loading", () => {
    expect(getProviderSettingsUiState(DEFAULT_PROVIDER_PERSISTENCE, true)).toEqual({
      showEnvironmentNotice: true,
      canSave: false,
    });
  });

  test("keeps save disabled for environment-managed providers", () => {
    expect(
      getProviderSettingsUiState(
        { mode: "environment", writable: false },
        false,
      )
    ).toEqual({
      showEnvironmentNotice: true,
      canSave: false,
    });
  });

  test("enables save only after writable file persistence is confirmed", () => {
    expect(
      getProviderSettingsUiState({ mode: "file", writable: true }, false)
    ).toEqual({
      showEnvironmentNotice: false,
      canSave: true,
    });
  });

  test("maps the selected OpenRouter preset to its Vercel environment key", () => {
    expect(getProviderEnvironmentKey("OPENROUTER_API_KEY")).toBe(
      "OPENROUTER_API_KEY"
    );
    expect(getProviderEnvironmentKey()).toBe("the provider API key");
  });
});
